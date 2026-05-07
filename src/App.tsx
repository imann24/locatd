import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { divIcon, type LatLngTuple } from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type MarkerModel = {
  id: string
  name: string
  position: LatLngTuple
  role: 'test-user' | 'self'
}

const DEFAULT_CENTER: LatLngTuple = [37.7749, -122.4194]

const TEST_MARKER: MarkerModel = {
  id: 'test-user',
  name: 'Test User (seed marker)',
  position: [37.7833, -122.4167],
  role: 'test-user',
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
    role === 'self' ? 'marker marker-self' : 'marker marker-test-user'
  return divIcon({
    className: iconClass,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  })
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

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!navigator.geolocation || !session?.user) return

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position: LatLngTuple = [coords.latitude, coords.longitude]
        setSelfMarker({
          id: session.user.id,
          name: session.user.email ?? 'You',
          position,
          role: 'self',
        })
        setCenter(position)
      },
      () => {
        setSelfMarker({
          id: session.user.id,
          name: session.user.email ?? 'You',
          position: DEFAULT_CENTER,
          role: 'self',
        })
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [session?.user])

  const markers = useMemo(
    () => [TEST_MARKER, ...(selfMarker ? [selfMarker] : [])],
    [selfMarker],
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
    if (error) setAuthError(error.message)
    setAuthLoading(false)
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
            <Popup>{marker.name}</Popup>
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
            Auth + map scaffold with Supabase and Leaflet.
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
                className="w-full rounded-lg bg-slate-700 px-3 py-2 font-medium hover:bg-slate-600"
                onClick={() => void supabase.auth.signOut()}
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
