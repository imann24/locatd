import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import { divIcon, type LatLngTuple } from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type MarkerModel = {
  id: string
  name: string
  position: LatLngTuple
  role: 'test-user' | 'self' | 'friend'
  lastSeenAt?: string
}

const DEFAULT_CENTER: LatLngTuple = [37.7749, -122.4194]
const STALE_AFTER_MS = 90_000

const TEST_MARKER: MarkerModel = {
  id: 'test-user',
  name: 'Test User (seed marker)',
  position: [37.7833, -122.4167],
  role: 'test-user',
}

type UserRow = {
  id: string
  username: string | null
  full_name: string | null
  location_visible: boolean
}

type LocationRow = {
  user_id: string
  lat: number
  lng: number
  last_seen_at: string
}

type BroadcastLocationPayload = {
  userId: string
  lat: number
  lng: number
  lastSeenAt: string
  visible: boolean
  name?: string
}

function MapRecenter({ center }: { center: LatLngTuple }) {
  const map = useMap()

  useEffect(() => {
    map.flyTo(center, map.getZoom(), { duration: 0.7 })
  }, [center, map])

  return null
}

function createMarkerIcon(role: MarkerModel['role']) {
  const iconClass =
    role === 'self'
      ? 'marker marker-self'
      : role === 'friend'
        ? 'marker marker-friend'
        : 'marker marker-test-user'

  return divIcon({
    className: iconClass,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  })
}

function formatLastSeen(lastSeenAt?: string) {
  if (!lastSeenAt) return 'Last seen unknown'
  const elapsedMs = Date.now() - new Date(lastSeenAt).getTime()
  if (elapsedMs < 15_000) return 'Live now'
  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 60) return `Seen ${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Seen ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `Seen ${hours}h ago`
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [center, setCenter] = useState<LatLngTuple>(DEFAULT_CENTER)
  const [selfMarker, setSelfMarker] = useState<MarkerModel | null>(null)
  const [friendMarkers, setFriendMarkers] = useState<Record<string, MarkerModel>>(
    {},
  )
  const [friendIds, setFriendIds] = useState<string[]>([])
  const [nameByUserId, setNameByUserId] = useState<Record<string, string>>({})
  const [locationVisible, setLocationVisible] = useState(true)
  const [locationStatus, setLocationStatus] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const ownChannelRef = useRef<RealtimeChannel | null>(null)
  const hasCenteredOnSelfRef = useRef(false)

  const resetLocationState = () => {
    setSelfMarker(null)
    setFriendMarkers({})
    setFriendIds([])
    setNameByUserId({})
    setLocationStatus(null)
    setLocationVisible(true)
    hasCenteredOnSelfRef.current = false
  }

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        resetLocationState()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user) return

    const bootstrapSocialMap = async () => {
      const userId = session.user.id

      const { data: selfUser } = await supabase
        .from('users')
        .select('id, username, full_name, location_visible')
        .eq('id', userId)
        .maybeSingle<UserRow>()

      if (selfUser) {
        setLocationVisible(selfUser.location_visible)
      }

      const { data: friendships } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)

      const acceptedFriendIds = (friendships ?? []).map((friendship) =>
        friendship.requester_id === userId
          ? friendship.addressee_id
          : friendship.requester_id,
      )
      setFriendIds(acceptedFriendIds)

      const idsToLoad = [userId, ...acceptedFriendIds]
      const nextNameMap: Record<string, string> = {
        [userId]: selfUser?.full_name || selfUser?.username || session.user.email || 'You',
      }

      if (acceptedFriendIds.length > 0) {
        const { data: friendProfiles } = await supabase
          .from('users')
          .select('id, username, full_name')
          .in('id', acceptedFriendIds)

        for (const profile of friendProfiles ?? []) {
          nextNameMap[profile.id] = profile.full_name || profile.username || 'Friend'
        }
      }
      setNameByUserId(nextNameMap)

      const { data: knownLocations } = await supabase
        .from('locations')
        .select('user_id, lat, lng, last_seen_at')
        .in('user_id', idsToLoad)

      const nextFriendMarkers: Record<string, MarkerModel> = {}
      for (const location of (knownLocations ?? []) as LocationRow[]) {
        const marker: MarkerModel = {
          id: location.user_id,
          name: nextNameMap[location.user_id] ?? 'Friend',
          position: [location.lat, location.lng],
          role: location.user_id === userId ? 'self' : 'friend',
          lastSeenAt: location.last_seen_at,
        }

        if (location.user_id === userId) {
          setSelfMarker(marker)
          if (!hasCenteredOnSelfRef.current) {
            setCenter(marker.position)
            hasCenteredOnSelfRef.current = true
          }
        } else {
          nextFriendMarkers[location.user_id] = marker
        }
      }

      setFriendMarkers(nextFriendMarkers)
    }

    void bootstrapSocialMap()
  }, [session?.user])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 15_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!session?.user || !navigator.geolocation || !locationVisible) return

    const userId = session.user.id
    const watchId = navigator.geolocation.watchPosition(
      async ({ coords }) => {
        const position: LatLngTuple = [coords.latitude, coords.longitude]
        const nowIso = new Date().toISOString()
        const selfName = nameByUserId[userId] ?? session.user.email ?? 'You'
        const marker: MarkerModel = {
          id: userId,
          name: selfName,
          position,
          role: 'self',
          lastSeenAt: nowIso,
        }

        setSelfMarker(marker)
        if (!hasCenteredOnSelfRef.current) {
          setCenter(position)
          hasCenteredOnSelfRef.current = true
        }

        const { error: upsertError } = await supabase.from('locations').upsert(
          {
            user_id: userId,
            lat: coords.latitude,
            lng: coords.longitude,
            heading: coords.heading,
            accuracy_meters: coords.accuracy,
            last_seen_at: nowIso,
          },
          { onConflict: 'user_id' },
        )
        if (upsertError) {
          setLocationStatus(upsertError.message)
          return
        }

        setLocationStatus('Sharing location in realtime')
        await ownChannelRef.current?.send({
          type: 'broadcast',
          event: 'location_update',
          payload: {
            userId,
            lat: coords.latitude,
            lng: coords.longitude,
            lastSeenAt: nowIso,
            visible: true,
            name: selfName,
          } satisfies BroadcastLocationPayload,
        })
      },
      () => {
        setLocationStatus('Unable to access GPS for live updates.')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 8_000 },
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [session?.user, locationVisible, nameByUserId])

  useEffect(() => {
    if (!session?.user) return

    const userId = session.user.id
    const idsToSubscribe = [userId, ...friendIds]
    const channels = idsToSubscribe.map((id) => {
      const channel = supabase
        .channel(`locatd:location:${id}`)
        .on('broadcast', { event: 'location_update' }, ({ payload }) => {
          const realtimePayload = payload as BroadcastLocationPayload
          if (!realtimePayload.userId) return

          if (realtimePayload.userId === userId) {
            if (!realtimePayload.visible) return
            setSelfMarker((previous) => ({
              id: userId,
              name: realtimePayload.name || previous?.name || 'You',
              position: [realtimePayload.lat, realtimePayload.lng],
              role: 'self',
              lastSeenAt: realtimePayload.lastSeenAt,
            }))
            return
          }

          if (!friendIds.includes(realtimePayload.userId)) return
          if (!realtimePayload.visible) {
            setFriendMarkers((previous) => {
              const next = { ...previous }
              delete next[realtimePayload.userId]
              return next
            })
            return
          }

          setFriendMarkers((previous) => ({
            ...previous,
            [realtimePayload.userId]: {
              id: realtimePayload.userId,
              name:
                realtimePayload.name ||
                nameByUserId[realtimePayload.userId] ||
                'Friend',
              position: [realtimePayload.lat, realtimePayload.lng],
              role: 'friend',
              lastSeenAt: realtimePayload.lastSeenAt,
            },
          }))
        })
        .subscribe()

      if (id === userId) {
        ownChannelRef.current = channel
      }
      return channel
    })

    return () => {
      ownChannelRef.current = null
      for (const channel of channels) {
        void supabase.removeChannel(channel)
      }
    }
  }, [session?.user, friendIds, nameByUserId])

  const markers = useMemo(
    () => [TEST_MARKER, ...(selfMarker ? [selfMarker] : []), ...Object.values(friendMarkers)],
    [selfMarker, friendMarkers],
  )

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError(null)
    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError(error.message)
    setAuthLoading(false)
  }

  const handleSignUp = async () => {
    setAuthError(null)
    setAuthLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
        },
      },
    })
    if (error) {
      const isRateLimited =
        error.message.toLowerCase().includes('rate limit') || error.status === 429
      setAuthError(
        isRateLimited
          ? 'Sign-up is temporarily rate-limited. Try again in a few minutes.'
          : error.message,
      )
    }
    setAuthLoading(false)
  }

  const handleToggleLocationVisibility = async () => {
    if (!session?.user) return

    const userId = session.user.id
    const nextVisible = !locationVisible
    setLocationVisible(nextVisible)

    const { error } = await supabase
      .from('users')
      .update({ location_visible: nextVisible })
      .eq('id', userId)
    if (error) {
      setLocationVisible(!nextVisible)
      setLocationStatus(error.message)
      return
    }

    if (!nextVisible) {
      setLocationStatus('Location hidden from friends')
      await ownChannelRef.current?.send({
        type: 'broadcast',
        event: 'location_update',
        payload: {
          userId,
          lat: selfMarker?.position[0] ?? DEFAULT_CENTER[0],
          lng: selfMarker?.position[1] ?? DEFAULT_CENTER[1],
          lastSeenAt: new Date().toISOString(),
          visible: false,
        } satisfies BroadcastLocationPayload,
      })
      return
    }

    setLocationStatus('Location sharing enabled')
  }

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!searchInput.trim()) return
    setSearchError(null)

    try {
      const params = new URLSearchParams({
        q: searchInput,
        format: 'json',
        limit: '1',
      })
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      )
      if (!response.ok) throw new Error('Search failed.')
      const data = (await response.json()) as Array<{ lat: string; lon: string }>
      if (!data.length) {
        setSearchError('No location found for that query.')
        return
      }
      const nextCenter: LatLngTuple = [
        Number.parseFloat(data[0].lat),
        Number.parseFloat(data[0].lon),
      ]
      setCenter(nextCenter)
    } catch {
      setSearchError('Could not reach Nominatim. Try again in a moment.')
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    resetLocationState()
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-900 text-slate-100">
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        className="h-full w-full touch-pan-x touch-pan-y"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapRecenter center={center} />
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={marker.position}
            icon={createMarkerIcon(marker.role)}
          >
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-medium">{marker.name}</p>
                {marker.role !== 'test-user' ? (
                  <p className="text-slate-500">
                    {formatLastSeen(marker.lastSeenAt)}
                    {marker.lastSeenAt &&
                    nowMs - new Date(marker.lastSeenAt).getTime() > STALE_AFTER_MS
                      ? ' (stale)'
                      : ''}
                  </p>
                ) : null}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <section className="pointer-events-none absolute inset-x-0 top-0 z-[500] p-3">
        <form
          className="pointer-events-auto flex items-center gap-2 rounded-xl bg-slate-950/80 p-2 shadow-lg ring-1 ring-slate-700 backdrop-blur"
          onSubmit={handleSearch}
        >
          <input
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-blue-500 placeholder:text-slate-500 focus:ring-2"
            placeholder="Search by address or place"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white"
          >
            Search
          </button>
        </form>
        {searchError ? (
          <p className="mt-2 rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-200">
            {searchError}
          </p>
        ) : null}
      </section>

      <aside className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] p-3 md:max-w-md">
        <div className="pointer-events-auto rounded-t-2xl bg-slate-950/85 p-4 shadow-xl ring-1 ring-slate-700 backdrop-blur md:rounded-2xl">
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-600 md:hidden" />
          <h1 className="text-lg font-semibold">locatd</h1>
          <p className="mt-1 text-xs text-slate-400">
            Live location map with Supabase realtime.
          </p>

          {!isSupabaseConfigured ? (
            <p className="mt-3 rounded-lg bg-amber-500/15 p-2 text-xs text-amber-100">
              Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to enable
              live auth.
            </p>
          ) : null}

          {session?.user ? (
            <div className="mt-4 space-y-2 text-sm">
              <p className="text-slate-300">
                Signed in as <span className="font-medium">{session.user.email}</span>
              </p>
              <button
                type="button"
                className={`w-full rounded-lg px-3 py-2 font-medium ${
                  locationVisible
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                }`}
                onClick={() => void handleToggleLocationVisibility()}
              >
                {locationVisible ? 'Hide my location' : 'Share my location'}
              </button>
              {locationStatus ? (
                <p className="text-xs text-slate-300">{locationStatus}</p>
              ) : null}
              <button
                type="button"
                className="w-full rounded-lg bg-slate-700 px-3 py-2 font-medium hover:bg-slate-600"
                onClick={() => void handleSignOut()}
              >
                Sign out
              </button>
            </div>
          ) : (
            <form className="mt-4 space-y-2" onSubmit={handleSignIn}>
              <input
                required
                type="email"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
                placeholder="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <input
                type="text"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
                placeholder="Username (for sign up)"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <input
                required
                type="password"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {authError ? <p className="text-xs text-rose-300">{authError}</p> : null}
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={authLoading}
                  type="submit"
                  className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Sign in
                </button>
                <button
                  disabled={authLoading}
                  type="button"
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  onClick={() => void handleSignUp()}
                >
                  Sign up
                </button>
              </div>
            </form>
          )}
        </div>
      </aside>
    </main>
  )
}

export default App
