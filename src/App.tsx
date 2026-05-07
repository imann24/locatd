import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import { divIcon, type LatLngTuple } from 'leaflet'
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type MarkerModel = {
  id: string
  name: string
  position: LatLngTuple
  role: 'test-user' | 'self' | 'friend' | 'pin'
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

type SearchUserRow = {
  id: string
  username: string | null
  full_name: string | null
}

type FriendshipRow = {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted' | 'blocked'
}

type LocationRow = {
  user_id: string
  lat: number
  lng: number
  last_seen_at: string
}

type PinRow = {
  id: string
  user_id: string
  lat: number
  lng: number
  note: string | null
  photo_url: string | null
  emoji: string | null
  visibility: 'private' | 'friends' | 'public'
  created_at: string
}

type ReactionRow = {
  pin_id: string
  emoji: string
}

type PinDraft = {
  lat: number
  lng: number
  note: string
  emoji: string
  photoUrl: string
  visibility: 'private' | 'friends' | 'public'
}

type ActivityItem = {
  id: string
  title: string
  detail: string
  at: string
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
        : role === 'pin'
          ? 'marker marker-pin'
        : 'marker marker-test-user'

  return divIcon({
    className: iconClass,
    iconSize: role === 'pin' ? [16, 16] : [20, 20],
    iconAnchor: role === 'pin' ? [8, 8] : [10, 10],
    popupAnchor: [0, role === 'pin' ? -10 : -12],
  })
}

function formatLastSeen(lastSeenAt: string | undefined, nowMs: number) {
  if (!lastSeenAt) return 'Last seen unknown'
  const elapsedMs = nowMs - new Date(lastSeenAt).getTime()
  if (elapsedMs < 15_000) return 'Live now'
  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 60) return `Seen ${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Seen ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `Seen ${hours}h ago`
}

function formatTimestamp(timestampIso: string) {
  const date = new Date(timestampIso)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function MapTapCapture({
  enabled,
  onTap,
}: {
  enabled: boolean
  onTap: (position: LatLngTuple) => void
}) {
  useMapEvents({
    click(event) {
      if (!enabled) return
      onTap([event.latlng.lat, event.latlng.lng])
    },
  })

  return null
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [center, setCenter] = useState<LatLngTuple>(DEFAULT_CENTER)
  const [selfMarker, setSelfMarker] = useState<MarkerModel | null>(null)
  const [friendMarkers, setFriendMarkers] = useState<Record<string, MarkerModel>>({})
  const [friendIds, setFriendIds] = useState<string[]>([])
  const [nameByUserId, setNameByUserId] = useState<Record<string, string>>({})
  const [locationVisible, setLocationVisible] = useState(true)
  const [locationStatus, setLocationStatus] = useState<string | null>(null)
  const [friendshipRows, setFriendshipRows] = useState<FriendshipRow[]>([])
  const [searchUsersInput, setSearchUsersInput] = useState('')
  const [userSearchResults, setUserSearchResults] = useState<SearchUserRow[]>([])
  const [friendStatus, setFriendStatus] = useState<string | null>(null)
  const [pins, setPins] = useState<PinRow[]>([])
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null)
  const [pinStatus, setPinStatus] = useState<string | null>(null)
  const [reactionCounts, setReactionCounts] = useState<
    Record<string, Record<string, number>>
  >({})
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false)
  const ownChannelRef = useRef<RealtimeChannel | null>(null)
  const hasCenteredOnSelfRef = useRef(false)
  const drawerStartYRef = useRef<number | null>(null)
  const drawerDeltaYRef = useRef(0)

  const resetLocationState = () => {
    setSelfMarker(null)
    setFriendMarkers({})
    setFriendIds([])
    setNameByUserId({})
    setLocationStatus(null)
    setLocationVisible(true)
    setFriendshipRows([])
    setUserSearchResults([])
    setFriendStatus(null)
    setPins([])
    setPinDraft(null)
    setPinStatus(null)
    setReactionCounts({})
    setActivityFeed([])
    hasCenteredOnSelfRef.current = false
  }

  const getDisplayName = (userId: string) => {
    if (userId === session?.user?.id) return 'You'
    return nameByUserId[userId] ?? 'Friend'
  }

  const loadSocialDataForUser = useCallback(async (activeSession: Session) => {
    const userId = activeSession.user.id

    const [{ data: selfUser }, { data: friendships }, { data: fetchedPins }] =
      await Promise.all([
        supabase
          .from('users')
          .select('id, username, full_name, location_visible')
          .eq('id', userId)
          .maybeSingle<UserRow>(),
        supabase
          .from('friendships')
          .select('id, requester_id, addressee_id, status')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
        supabase
          .from('pins')
          .select('id, user_id, lat, lng, note, photo_url, emoji, visibility, created_at')
          .order('created_at', { ascending: false })
          .limit(50),
      ])

    const friendshipList = (friendships ?? []) as FriendshipRow[]
    setFriendshipRows(friendshipList)

    const acceptedFriendIds = friendshipList
      .filter((row) => row.status === 'accepted')
      .map((row) =>
        row.requester_id === userId ? row.addressee_id : row.requester_id,
      )
    setFriendIds(acceptedFriendIds)

    if (selfUser) {
      setLocationVisible(selfUser.location_visible)
    }

    const relatedUserIds = new Set<string>([
      userId,
      ...friendshipList.map((row) => row.requester_id),
      ...friendshipList.map((row) => row.addressee_id),
      ...acceptedFriendIds,
      ...(fetchedPins ?? []).map((pin) => pin.user_id),
    ])

    const relatedIds = [...relatedUserIds]
    const nextNameMap: Record<string, string> = {
      [userId]:
        selfUser?.full_name || selfUser?.username || activeSession.user.email || 'You',
    }

    if (relatedIds.length > 0) {
      const { data: relatedUsers } = await supabase
        .from('users')
        .select('id, username, full_name')
        .in('id', relatedIds)

      for (const profile of relatedUsers ?? []) {
        nextNameMap[profile.id] = profile.full_name || profile.username || 'Friend'
      }
    }
    setNameByUserId(nextNameMap)

    const locationTargetIds = [userId, ...acceptedFriendIds]
    const { data: knownLocations } =
      locationTargetIds.length > 0
        ? await supabase
            .from('locations')
            .select('user_id, lat, lng, last_seen_at')
            .in('user_id', locationTargetIds)
        : { data: [] as LocationRow[] }

    let nextSelfMarker: MarkerModel | null = null
    const nextFriendMarkers: Record<string, MarkerModel> = {}
    const locationRows = (knownLocations ?? []) as LocationRow[]

    for (const location of locationRows) {
      const marker: MarkerModel = {
        id: location.user_id,
        name: nextNameMap[location.user_id] ?? 'Friend',
        position: [location.lat, location.lng],
        role: location.user_id === userId ? 'self' : 'friend',
        lastSeenAt: location.last_seen_at,
      }
      if (location.user_id === userId) {
        nextSelfMarker = marker
      } else {
        nextFriendMarkers[location.user_id] = marker
      }
    }

    setSelfMarker(nextSelfMarker)
    if (nextSelfMarker && !hasCenteredOnSelfRef.current) {
      setCenter(nextSelfMarker.position)
      hasCenteredOnSelfRef.current = true
    }
    setFriendMarkers(nextFriendMarkers)

    const nextPins = (fetchedPins ?? []) as PinRow[]
    setPins(nextPins)

    let nextReactionCounts: Record<string, Record<string, number>> = {}
    if (nextPins.length > 0) {
      const { data: reactions } = await supabase
        .from('reactions')
        .select('pin_id, emoji')
        .in(
          'pin_id',
          nextPins.map((pin) => pin.id),
        )

      nextReactionCounts = {}
      for (const reaction of (reactions ?? []) as ReactionRow[]) {
        if (!nextReactionCounts[reaction.pin_id]) {
          nextReactionCounts[reaction.pin_id] = {}
        }
        nextReactionCounts[reaction.pin_id][reaction.emoji] =
          (nextReactionCounts[reaction.pin_id][reaction.emoji] ?? 0) + 1
      }
    }
    setReactionCounts(nextReactionCounts)

    const pinFeed: ActivityItem[] = nextPins.slice(0, 12).map((pin) => ({
      id: `pin-${pin.id}`,
      title: `${nextNameMap[pin.user_id] ?? 'Friend'} dropped a pin ${
        pin.emoji ?? '📍'
      }`,
      detail: pin.note ?? 'No note attached.',
      at: pin.created_at,
    }))

    const checkinFeed: ActivityItem[] = locationRows
      .filter((row) => row.user_id !== userId)
      .map((row) => ({
        id: `checkin-${row.user_id}`,
        title: `${nextNameMap[row.user_id] ?? 'Friend'} checked in`,
        detail: formatLastSeen(row.last_seen_at, Date.now()),
        at: row.last_seen_at,
      }))

    setActivityFeed(
      [...pinFeed, ...checkinFeed]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 20),
    )
  }, [])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        void loadSocialDataForUser(data.session)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession) {
        void loadSocialDataForUser(nextSession)
      } else {
        resetLocationState()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [loadSocialDataForUser])

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

  const userMarkers = [
    TEST_MARKER,
    ...(selfMarker ? [selfMarker] : []),
    ...Object.values(friendMarkers),
  ]
  const currentUserId = session?.user?.id ?? ''
  const incomingRequests = friendshipRows.filter(
    (row) => row.status === 'pending' && row.addressee_id === currentUserId,
  )
  const outgoingRequests = friendshipRows.filter(
    (row) => row.status === 'pending' && row.requester_id === currentUserId,
  )
  const friends = friendshipRows.filter((row) => row.status === 'accepted')

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError(null)
    setAuthNotice(null)
    setAuthLoading(true)
    const normalizedEmail = email.trim().toLowerCase()
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })
    if (error) {
      const isInvalidCredentials =
        error.message.toLowerCase().includes('invalid login credentials') ||
        error.code === 'invalid_credentials'
      setAuthError(
        isInvalidCredentials
          ? 'Invalid email or password. Try again or reset your password.'
          : error.message,
      )
      setIsDrawerExpanded(true)
    }
    setAuthLoading(false)
  }

  const handleSignUp = async () => {
    setAuthError(null)
    setAuthNotice(null)
    setAuthLoading(true)
    const normalizedEmail = email.trim().toLowerCase()
    const { error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          username: username.trim(),
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
      setIsDrawerExpanded(true)
    } else {
      setAuthNotice('Account created. You can sign in now.')
    }
    setAuthLoading(false)
  }

  const handleForgotPassword = async () => {
    setAuthError(null)
    setAuthNotice(null)
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setAuthError('Enter your email first, then tap Forgot password.')
      setIsDrawerExpanded(true)
      return
    }

    setAuthLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail)
    if (error) {
      setAuthError(error.message)
      setIsDrawerExpanded(true)
    } else {
      setAuthNotice('Password reset email sent.')
    }
    setAuthLoading(false)
  }

  const handleSearchUsers = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFriendStatus(null)
    if (!searchUsersInput.trim()) {
      setUserSearchResults([])
      return
    }

    const { data, error } = await supabase.rpc('search_users', {
      query_text: searchUsersInput.trim(),
    })
    if (error) {
      setFriendStatus(error.message)
      return
    }
    setUserSearchResults((data ?? []) as SearchUserRow[])
  }

  const handleSendFriendRequest = async (targetUserId: string) => {
    if (!session?.user) return
    setFriendStatus(null)
    const userId = session.user.id

    const directExisting = friendshipRows.find(
      (row) =>
        row.requester_id === userId &&
        row.addressee_id === targetUserId &&
        row.status !== 'blocked',
    )
    if (directExisting) {
      setFriendStatus('Friend request already exists.')
      return
    }

    const reversePending = friendshipRows.find(
      (row) =>
        row.requester_id === targetUserId &&
        row.addressee_id === userId &&
        row.status === 'pending',
    )
    if (reversePending) {
      const { error: acceptError } = await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', reversePending.id)
      if (acceptError) {
        setFriendStatus(acceptError.message)
        return
      }
      setFriendStatus('Friend request accepted.')
      await loadSocialDataForUser(session)
      return
    }

    const { error } = await supabase.from('friendships').insert({
      requester_id: userId,
      addressee_id: targetUserId,
      status: 'pending',
    })
    if (error) {
      setFriendStatus(error.message)
      return
    }

    setFriendStatus('Friend request sent.')
    await loadSocialDataForUser(session)
  }

  const handleAcceptRequest = async (friendshipId: string) => {
    setFriendStatus(null)
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId)
    if (error) {
      setFriendStatus(error.message)
      return
    }
    if (session) {
      await loadSocialDataForUser(session)
    }
  }

  const handleDeclineRequest = async (friendshipId: string) => {
    setFriendStatus(null)
    const { error } = await supabase.from('friendships').delete().eq('id', friendshipId)
    if (error) {
      setFriendStatus(error.message)
      return
    }
    if (session) {
      await loadSocialDataForUser(session)
    }
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

  const handleMapTap = (position: LatLngTuple) => {
    if (!session?.user) return
    setIsDrawerExpanded(true)
    setPinDraft({
      lat: position[0],
      lng: position[1],
      note: '',
      emoji: '📍',
      photoUrl: '',
      visibility: 'friends',
    })
    setPinStatus('Pin draft placed. Add details below.')
  }

  const handleCreatePin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session?.user || !pinDraft) return
    setPinStatus(null)
    const { error } = await supabase.from('pins').insert({
      user_id: session.user.id,
      lat: pinDraft.lat,
      lng: pinDraft.lng,
      note: pinDraft.note.trim() || null,
      photo_url: pinDraft.photoUrl.trim() || null,
      emoji: pinDraft.emoji.trim() || null,
      visibility: pinDraft.visibility,
    })
    if (error) {
      setPinStatus(error.message)
      return
    }

    setPinDraft(null)
    setPinStatus('Pin posted.')
    await loadSocialDataForUser(session)
  }

  const handleReactToPin = async (pinId: string, emoji: string) => {
    if (!session?.user) return
    const { error } = await supabase.from('reactions').insert({
      pin_id: pinId,
      user_id: session.user.id,
      emoji,
    })

    if (error?.message.includes('duplicate key value')) {
      await supabase
        .from('reactions')
        .delete()
        .eq('pin_id', pinId)
        .eq('user_id', session.user.id)
        .eq('emoji', emoji)
      await loadSocialDataForUser(session)
      return
    }

    if (error) {
      setPinStatus(error.message)
      return
    }
    await loadSocialDataForUser(session)
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

  const handleDrawerTouchStart = (clientY: number) => {
    drawerStartYRef.current = clientY
    drawerDeltaYRef.current = 0
  }

  const handleDrawerTouchMove = (clientY: number) => {
    if (drawerStartYRef.current === null) return
    drawerDeltaYRef.current = clientY - drawerStartYRef.current
  }

  const handleDrawerTouchEnd = () => {
    const delta = drawerDeltaYRef.current
    if (delta < -40) setIsDrawerExpanded(true)
    if (delta > 40) setIsDrawerExpanded(false)
    drawerStartYRef.current = null
    drawerDeltaYRef.current = 0
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
        <MapTapCapture enabled={Boolean(session?.user)} onTap={handleMapTap} />
        {userMarkers.map((marker) => (
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
                    {formatLastSeen(marker.lastSeenAt, nowMs)}
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
        {pins.map((pin) => (
          <Marker
            key={`pin-${pin.id}`}
            position={[pin.lat, pin.lng]}
            icon={createMarkerIcon('pin')}
          >
            <Popup>
              <div className="w-52 space-y-2 text-sm">
                <p className="font-medium">{getDisplayName(pin.user_id)}</p>
                <p className="text-xs text-slate-500">{formatTimestamp(pin.created_at)}</p>
                <p>{pin.emoji ?? '📍'} {pin.note ?? 'No note'}</p>
                {pin.photo_url ? (
                  <a
                    className="text-xs text-blue-500 underline"
                    href={pin.photo_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open photo
                  </a>
                ) : null}
                <div className="flex flex-wrap gap-1 text-xs">
                  {Object.entries(reactionCounts[pin.id] ?? {}).map(([emoji, count]) => (
                    <span
                      key={`${pin.id}-${emoji}`}
                      className="rounded bg-slate-800 px-2 py-1"
                    >
                      {emoji} {count}
                    </span>
                  ))}
                </div>
                {session?.user ? (
                  <div className="flex gap-1">
                    {['👍', '❤️', '😂'].map((emoji) => (
                      <button
                        key={`${pin.id}-react-${emoji}`}
                        type="button"
                        className="rounded bg-slate-700 px-2 py-1 text-xs"
                        onClick={() => void handleReactToPin(pin.id, emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
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

      <aside className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] overflow-hidden p-3 md:max-w-md">
        <div
          className={`pointer-events-auto rounded-t-2xl bg-slate-950/85 p-4 shadow-xl ring-1 ring-slate-700 backdrop-blur transition-transform duration-300 md:translate-y-0 md:rounded-2xl ${
            isDrawerExpanded ? 'translate-y-0' : 'translate-y-[calc(100%-8.5rem)]'
          }`}
        >
          <button
            type="button"
            className="mb-3 w-full cursor-grab active:cursor-grabbing md:hidden"
            onClick={() => setIsDrawerExpanded((previous) => !previous)}
            onTouchStart={(event) => handleDrawerTouchStart(event.touches[0].clientY)}
            onTouchMove={(event) => handleDrawerTouchMove(event.touches[0].clientY)}
            onTouchEnd={handleDrawerTouchEnd}
            aria-label={isDrawerExpanded ? 'Collapse social drawer' : 'Expand social drawer'}
          >
            <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-slate-600" />
            <p className="text-center text-[11px] text-slate-400">
              {isDrawerExpanded ? 'Swipe down to collapse' : 'Swipe up for social'}
            </p>
          </button>
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
            <div className="mt-4 space-y-3 text-sm">
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
              <form className="space-y-2" onSubmit={handleSearchUsers}>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
                  placeholder="Find users by name"
                  value={searchUsersInput}
                  onChange={(event) => setSearchUsersInput(event.target.value)}
                />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-indigo-600 px-3 py-2 font-medium hover:bg-indigo-500"
                >
                  Search users
                </button>
              </form>
              {userSearchResults.length > 0 ? (
                <div className="max-h-24 space-y-1 overflow-y-auto rounded-lg bg-slate-900/70 p-2">
                  {userSearchResults.map((user) => (
                    <div
                      key={`search-user-${user.id}`}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="truncate">
                        {user.full_name || user.username || 'User'}
                      </span>
                      <button
                        type="button"
                        className="rounded bg-blue-600 px-2 py-1"
                        onClick={() => void handleSendFriendRequest(user.id)}
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {incomingRequests.length > 0 ? (
                <div className="space-y-1 rounded-lg bg-slate-900/70 p-2">
                  <p className="text-xs font-medium text-slate-300">Incoming requests</p>
                  {incomingRequests.map((row) => (
                    <div key={`incoming-${row.id}`} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate">
                        {getDisplayName(row.requester_id)}
                      </span>
                      <button
                        type="button"
                        className="rounded bg-emerald-600 px-2 py-1"
                        onClick={() => void handleAcceptRequest(row.id)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="rounded bg-slate-600 px-2 py-1"
                        onClick={() => void handleDeclineRequest(row.id)}
                      >
                        Decline
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="space-y-1 rounded-lg bg-slate-900/70 p-2">
                <p className="text-xs font-medium text-slate-300">Friends</p>
                {friends.length ? (
                  friends.map((row) => {
                    const friendId =
                      row.requester_id === session.user.id
                        ? row.addressee_id
                        : row.requester_id
                    return (
                      <p key={`friend-${row.id}`} className="text-xs">
                        {getDisplayName(friendId)}
                      </p>
                    )
                  })
                ) : (
                  <p className="text-xs text-slate-500">No friends added yet.</p>
                )}
              </div>
              {outgoingRequests.length > 0 ? (
                <div className="space-y-1 rounded-lg bg-slate-900/70 p-2">
                  <p className="text-xs font-medium text-slate-300">Pending sent requests</p>
                  {outgoingRequests.map((row) => (
                    <p key={`outgoing-${row.id}`} className="text-xs text-slate-400">
                      {getDisplayName(row.addressee_id)}
                    </p>
                  ))}
                </div>
              ) : null}
              {friendStatus ? (
                <p className="text-xs text-sky-300">{friendStatus}</p>
              ) : null}
              {pinDraft ? (
                <form className="space-y-2 rounded-lg bg-slate-900/70 p-2" onSubmit={handleCreatePin}>
                  <p className="text-xs font-medium text-slate-300">
                    New pin at {pinDraft.lat.toFixed(4)}, {pinDraft.lng.toFixed(4)}
                  </p>
                  <input
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                    placeholder="Emoji"
                    value={pinDraft.emoji}
                    onChange={(event) =>
                      setPinDraft((previous) =>
                        previous ? { ...previous, emoji: event.target.value } : previous,
                      )
                    }
                  />
                  <input
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                    placeholder="Note"
                    value={pinDraft.note}
                    onChange={(event) =>
                      setPinDraft((previous) =>
                        previous ? { ...previous, note: event.target.value } : previous,
                      )
                    }
                  />
                  <input
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                    placeholder="Photo URL (optional)"
                    value={pinDraft.photoUrl}
                    onChange={(event) =>
                      setPinDraft((previous) =>
                        previous ? { ...previous, photoUrl: event.target.value } : previous,
                      )
                    }
                  />
                  <select
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                    value={pinDraft.visibility}
                    onChange={(event) =>
                      setPinDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              visibility: event.target.value as PinDraft['visibility'],
                            }
                          : previous,
                      )
                    }
                  >
                    <option value="private">Private</option>
                    <option value="friends">Friends</option>
                    <option value="public">Public</option>
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="submit"
                      className="rounded bg-fuchsia-600 px-2 py-1 text-xs font-medium"
                    >
                      Drop pin
                    </button>
                    <button
                      type="button"
                      className="rounded bg-slate-700 px-2 py-1 text-xs"
                      onClick={() => setPinDraft(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <p className="text-xs text-slate-500">
                  Tap the map to place a new pin.
                </p>
              )}
              {pinStatus ? <p className="text-xs text-sky-300">{pinStatus}</p> : null}
              <div className="space-y-1 rounded-lg bg-slate-900/70 p-2">
                <p className="text-xs font-medium text-slate-300">Activity feed</p>
                {activityFeed.length ? (
                  <div className="max-h-28 space-y-1 overflow-y-auto">
                    {activityFeed.map((item) => (
                      <div key={item.id} className="text-xs text-slate-300">
                        <p>{item.title}</p>
                        <p className="text-slate-500">
                          {item.detail} - {formatTimestamp(item.at)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No activity yet.</p>
                )}
              </div>
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
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (authError) setAuthError(null)
                }}
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
                onChange={(event) => {
                  setPassword(event.target.value)
                  if (authError) setAuthError(null)
                }}
              />
              {authError ? <p className="text-xs text-rose-300">{authError}</p> : null}
              {authNotice ? <p className="text-xs text-emerald-300">{authNotice}</p> : null}
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
              <button
                disabled={authLoading}
                type="button"
                className="w-full rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-50"
                onClick={() => void handleForgotPassword()}
              >
                Forgot password
              </button>
            </form>
          )}
        </div>
      </aside>
    </main>
  )
}

export default App
