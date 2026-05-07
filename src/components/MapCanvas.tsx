import { useEffect } from 'react'
import { divIcon, type LatLngTuple } from 'leaflet'
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'

export type MapMarker = {
  id: string
  name: string
  position: LatLngTuple
  role: 'test-user' | 'self' | 'friend'
  lastSeenAt?: string
}

export type MapPin = {
  id: string
  user_id: string
  lat: number
  lng: number
  note: string | null
  photo_url: string | null
  emoji: string | null
  created_at: string
}

type MapCanvasProps = {
  center: LatLngTuple
  markers: MapMarker[]
  pins: MapPin[]
  nowMs: number
  staleAfterMs: number
  canDropPin: boolean
  reactionCounts: Record<string, Record<string, number>>
  onMapTap: (position: LatLngTuple) => void
  onReactToPin: (pinId: string, emoji: string) => void
  getDisplayName: (userId: string) => string
  formatTimestamp: (timestampIso: string) => string
}

function MapRecenter({ center }: { center: LatLngTuple }) {
  const map = useMap()

  useEffect(() => {
    map.flyTo(center, map.getZoom(), { duration: 0.7 })
  }, [center, map])

  return null
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

function createMarkerIcon(role: 'test-user' | 'self' | 'friend' | 'pin') {
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

export function MapCanvas({
  center,
  markers,
  pins,
  nowMs,
  staleAfterMs,
  canDropPin,
  reactionCounts,
  onMapTap,
  onReactToPin,
  getDisplayName,
  formatTimestamp,
}: MapCanvasProps) {
  return (
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
      <MapTapCapture enabled={canDropPin} onTap={onMapTap} />
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
                  {formatLastSeen(marker.lastSeenAt, nowMs)}
                  {marker.lastSeenAt &&
                  nowMs - new Date(marker.lastSeenAt).getTime() > staleAfterMs
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
              <p>
                {pin.emoji ?? '📍'} {pin.note ?? 'No note'}
              </p>
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
              {canDropPin ? (
                <div className="flex gap-1">
                  {['👍', '❤️', '😂'].map((emoji) => (
                    <button
                      key={`${pin.id}-react-${emoji}`}
                      type="button"
                      className="rounded bg-slate-700 px-2 py-1 text-xs"
                      onClick={() => onReactToPin(pin.id, emoji)}
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
  )
}
