import { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Clock, Truck, Navigation, Radio, Wifi, WifiOff, CircleDot, ArrowRight, Check } from 'lucide-react';
import { loadGoogleMaps } from '../../../lib/google-maps-loader';
import { EVENT_LABELS } from '../../../lib/routing-template-seed';

const SOURCE_LABELS = {
  eld: { label: 'ELD', icon: Radio, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-950/40' },
  mobile_app: { label: 'Mobile App', icon: Wifi, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-950/40' },
  manual: { label: 'Manual', icon: MapPin, color: 'text-gray-600 dark:text-slate-300', bg: 'bg-gray-100 dark:bg-slate-800' },
};

function labelFor(type) {
  return EVENT_LABELS?.[type] || (type || '').replace(/^./, (c) => c.toUpperCase());
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatMinutes(min) {
  if (!min || min === 0) return '—';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function TrackingTab({ load }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const [loading, setLoading] = useState(true);
  const [gpsSource, setGpsSource] = useState(null);
  const [lastPing, setLastPing] = useState(null);
  const [geofenceEvents, setGeofenceEvents] = useState([]);
  const [driveSegments, setDriveSegments] = useState([]);
  const [routingEvents, setRoutingEvents] = useState([]);
  const [moves, setMoves] = useState([]);
  const [driverLocation, setDriverLocation] = useState(null);
  const [locations, setLocations] = useState({});
  const [selectedEventId, setSelectedEventId] = useState(null);

  const driverName = load.driver
    ? `${load.driver.first_name || ''} ${load.driver.last_name || ''}`.trim() || load.driver.name
    : null;

  // Fetch tracking data
  useEffect(() => {
    async function fetchTracking() {
      try {
        const res = await fetch(`/api/tenant/loads/${load.id}/tracking`);
        if (res.ok) {
          const data = await res.json();
          setGeofenceEvents(data.geofence_events || []);
          setDriveSegments(data.drive_segments || []);
          setRoutingEvents(data.routing_events || []);
          setMoves(data.moves || []);
          setLocations(data.locations || {});
          setLastPing(data.last_ping || null);
          setGpsSource(data.gps_source || null);
          if (data.last_ping) {
            setDriverLocation({
              lat: parseFloat(data.last_ping.latitude),
              lng: parseFloat(data.last_ping.longitude),
            });
          }
        }
      } catch {}
      setLoading(false);
    }
    fetchTracking();
  }, [load.id]);

  // Group routing events by move
  const eventsByMove = {};
  for (const evt of routingEvents) {
    if (!eventsByMove[evt.move_id]) eventsByMove[evt.move_id] = [];
    eventsByMove[evt.move_id].push(evt);
  }

  // Init map
  useEffect(() => {
    if (!mapRef.current || loading) return;
    let cancelled = false;

    async function init() {
      try {
        const google = await loadGoogleMaps();
        if (cancelled) return;

        let center = { lat: 32.7767, lng: -96.7970 };
        const bounds = new google.maps.LatLngBounds();
        let hasPoints = false;

        const map = new google.maps.Map(mapRef.current, {
          zoom: 10, center,
          mapTypeId: 'hybrid',
          disableDefaultUI: false,
          zoomControl: true, mapTypeControl: true,
          streetViewControl: false, fullscreenControl: true,
          styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }],
        });
        mapInstanceRef.current = map;

        // Draw location markers + actual geofences (circle or polygon)
        const locDefs = [
          { org: locations.pickup || load.pickup_org, label: 'Pickup', color: '#f59e0b', icon: '📦' },
          { org: locations.delivery || load.delivery_org, label: 'Delivery', color: '#3b82f6', icon: '🏢' },
          { org: locations.return || load.return_org, label: 'Return', color: '#10b981', icon: '🔄' },
        ];

        for (const loc of locDefs) {
          if (!loc.org) continue;
          const addr = [loc.org.address_line1, loc.org.city, loc.org.state].filter(Boolean).join(', ');
          if (!addr) continue;
          try {
            const geocoder = new google.maps.Geocoder();
            const result = await new Promise((resolve, reject) => {
              geocoder.geocode({ address: addr }, (results, status) => {
                if (status === 'OK' && results[0]) resolve(results[0].geometry.location);
                else reject();
              });
            });
            const pos = { lat: result.lat(), lng: result.lng() };
            bounds.extend(pos);
            hasPoints = true;

            // Draw the actual geofence — circle or polygon
            const geoType = loc.org.geofence_type;
            const geoData = loc.org.geofence_data;

            if (geoType === 'polygon' && geoData?.points?.length >= 3) {
              // Polygon geofence
              const polygon = new google.maps.Polygon({
                map,
                paths: geoData.points.map((p) => ({ lat: p.lat, lng: p.lng })),
                fillColor: loc.color, fillOpacity: 0.12,
                strokeColor: loc.color, strokeOpacity: 0.5, strokeWeight: 2,
              });
              // Extend bounds to include all polygon points
              geoData.points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
            } else if (geoType === 'circle' && geoData?.center) {
              // Circle geofence with actual radius
              new google.maps.Circle({
                map,
                center: { lat: geoData.center.lat, lng: geoData.center.lng },
                radius: geoData.radius_meters || 200,
                fillColor: loc.color, fillOpacity: 0.1,
                strokeColor: loc.color, strokeOpacity: 0.4, strokeWeight: 1.5,
              });
              bounds.extend({ lat: geoData.center.lat, lng: geoData.center.lng });
            } else {
              // No geofence set — draw a default small circle at the geocoded location
              new google.maps.Circle({
                map, center: pos, radius: 150,
                fillColor: loc.color, fillOpacity: 0.06,
                strokeColor: loc.color, strokeOpacity: 0.2, strokeWeight: 1,
                strokeDashArray: [4, 4],
              });
            }

            const marker = new google.maps.Marker({
              map, position: pos,
              title: `${loc.label}: ${loc.org.name}`,
              label: { text: loc.icon, fontSize: '16px' },
            });
            // Store marker for jump-to
            markersRef.current[loc.label.toLowerCase()] = { marker, pos };
          } catch {}
        }

        // Driver position
        if (driverLocation) {
          new google.maps.Marker({
            map, position: driverLocation,
            title: driverName || 'Driver',
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 6, rotation: lastPing?.heading || 0,
              fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2,
            },
          });
          bounds.extend(driverLocation);
          hasPoints = true;
        }

        if (hasPoints) map.fitBounds(bounds, 60);
      } catch {}
    }
    init();
    return () => { cancelled = true; };
  }, [loading, driverLocation]);

  // Jump to a routing event's location on the map
  function handleEventClick(evt) {
    setSelectedEventId(evt.id);
    const map = mapInstanceRef.current;
    if (!map) return;

    // Try to find the location marker
    const locName = evt.location_name?.toLowerCase() || '';
    for (const [key, val] of Object.entries(markersRef.current)) {
      if (locName.includes(key) || key.includes(locName.split(' ')[0]?.toLowerCase())) {
        map.panTo(val.pos);
        map.setZoom(15);
        return;
      }
    }
  }

  // Summary stats
  const totalDriveMin = driveSegments.filter((s) => s.segment_type === 'driving').reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const totalDwellMin = driveSegments.filter((s) => s.segment_type === 'dwell').reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const totalMiles = driveSegments.filter((s) => s.segment_type === 'driving').reduce((sum, s) => sum + (parseFloat(s.distance_miles) || 0), 0);
  const avgSpeed = totalDriveMin > 0 ? (totalMiles / (totalDriveMin / 60)).toFixed(0) : '—';

  // Merge timeline
  const timeline = [
    ...geofenceEvents.map((e) => ({ ...e, _type: 'geofence', _time: e.recorded_at })),
    ...driveSegments.map((s) => ({ ...s, _type: 'segment', _time: s.started_at })),
  ].sort((a, b) => new Date(a._time) - new Date(b._time));

  const hasData = timeline.length > 0 || driverLocation;
  const isStale = lastPing && (Date.now() - new Date(lastPing.received_at).getTime() > 10 * 60 * 1000);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-strong flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            Live Tracking
          </h2>
          {driverName && <p className="text-body text-muted mt-0.5">Driver: {driverName}</p>}
        </div>
        <div className="flex items-center gap-3">
          {gpsSource ? (
            <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${SOURCE_LABELS[gpsSource]?.bg} ${SOURCE_LABELS[gpsSource]?.color}`}>
              {(() => { const Icon = SOURCE_LABELS[gpsSource]?.icon || Wifi; return <Icon className="w-3.5 h-3.5" />; })()}
              {SOURCE_LABELS[gpsSource]?.label}
              {isStale && <span className="text-amber-600 dark:text-amber-400 ml-1">· Stale</span>}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-slate-500 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-slate-800">
              <WifiOff className="w-3.5 h-3.5" /> No GPS Signal
            </div>
          )}
        </div>
      </div>

      {/* Map + Routing Sidebar */}
      <div className="flex gap-0 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden" style={{ height: 450 }}>
        {/* Left: Routing Events Sidebar */}
        <div className="w-[240px] shrink-0 border-r border-gray-200 dark:border-slate-700 overflow-y-auto bg-gray-50/50 dark:bg-slate-900">
          <div className="px-3 py-2.5 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <div className="text-section-title text-strong">Route Events</div>
            <div className="text-[10px] text-gray-400 dark:text-slate-500">Click to jump on map</div>
          </div>
          {moves.map((m, mIdx) => (
            <div key={m.id}>
              <div className="px-3 py-1.5 bg-gray-100/80 dark:bg-slate-800 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide border-b border-gray-200 dark:border-slate-700">
                Move {mIdx + 1}
                {m.started_at && <span className="ml-1 text-green-600 dark:text-green-400">· Started</span>}
                {m.completed_at && <span className="ml-1 text-emerald-600 dark:text-emerald-400">· Done</span>}
              </div>
              {(eventsByMove[m.id] || []).map((evt) => {
                const isSelected = selectedEventId === evt.id;
                const hasArrived = !!evt.arrived_at;
                const hasDeparted = !!evt.departed_at;
                const isDone = hasArrived && hasDeparted;
                return (
                  <button key={evt.id} type="button" onClick={() => handleEventClick(evt)}
                    className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-slate-800 transition-colors ${
                      isSelected ? 'bg-blue-50 dark:bg-blue-950/40 border-l-2 border-l-blue-500' : 'hover:bg-gray-100 dark:hover:bg-slate-800'
                    }`}>
                    <div className="flex items-center gap-2">
                      {isDone ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : hasArrived ? (
                        <CircleDot className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 dark:border-slate-600 shrink-0" />
                      )}
                      <span className="text-xs font-medium text-strong truncate">{labelFor(evt.event_type)}</span>
                    </div>
                    {evt.location_name && (
                      <div className="text-[10px] text-gray-500 dark:text-slate-400 truncate mt-0.5 pl-5.5">
                        {evt.location_name}
                        {evt.city && <span> · {evt.city}, {evt.state}</span>}
                      </div>
                    )}
                    {(hasArrived || hasDeparted) && (
                      <div className="flex gap-3 mt-1 pl-5.5">
                        {hasArrived && (
                          <span className="text-[9px] text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-950/40 px-1 py-0.5 rounded">
                            In {formatTime(evt.arrived_at)}
                          </span>
                        )}
                        {hasDeparted && (
                          <span className="text-[9px] text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950/40 px-1 py-0.5 rounded">
                            Out {formatTime(evt.departed_at)}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Right: Map */}
        <div className="flex-1 min-w-0">
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>

      {/* Drive Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Drive Time</div>
          <div className="text-lg font-bold text-strong mt-1">{formatMinutes(totalDriveMin)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Dwell Time</div>
          <div className="text-lg font-bold text-strong mt-1">{formatMinutes(totalDwellMin)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Distance</div>
          <div className="text-lg font-bold text-strong mt-1">{totalMiles > 0 ? `${totalMiles.toFixed(1)} mi` : '—'}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Avg Speed</div>
          <div className="text-lg font-bold text-strong mt-1">{avgSpeed !== '—' ? `${avgSpeed} mph` : '—'}</div>
        </div>
      </div>

      {/* Movement Timeline */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
          <h3 className="text-section-title text-strong">Movement Timeline</h3>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-slate-800">
          {!hasData ? (
            <div className="px-4 py-12 text-center">
              <Truck className="w-10 h-10 mx-auto text-gray-300 dark:text-slate-600 mb-3" />
              <p className="text-body text-muted font-medium">No tracking data yet</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                GPS data will appear here once the driver starts the load via the mobile app or ELD.
              </p>
              <div className="flex items-center justify-center gap-4 mt-4 text-[10px] text-gray-400 dark:text-slate-500">
                <span className="flex items-center gap-1"><Radio className="w-3 h-3 text-green-500" /> ELD (Primary)</span>
                <span className="flex items-center gap-1"><Wifi className="w-3 h-3 text-blue-500" /> Mobile App</span>
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-gray-400 dark:text-slate-500" /> Manual</span>
              </div>
            </div>
          ) : (
            timeline.map((item, idx) => (
              <div key={idx} className="flex items-start gap-3 px-4 py-3">
                <div className="flex flex-col items-center pt-1">
                  {item._type === 'geofence' ? (
                    <CircleDot className={`w-4 h-4 ${item.event_type === 'enter' ? 'text-green-500' : 'text-red-500'}`} />
                  ) : (
                    <ArrowRight className={`w-4 h-4 ${item.segment_type === 'driving' ? 'text-blue-500' : 'text-amber-500'}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {item._type === 'geofence' ? (
                    <>
                      <div className="text-body font-medium text-strong">
                        {item.event_type === 'enter' ? '📍 Entered' : '🚛 Exited'} geofence
                      </div>
                      <div className="text-helper text-muted mt-0.5">{item.organization?.name || 'Unknown'}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-body font-medium text-strong">
                        {item.segment_type === 'driving' ? '🚛 Driving' : item.segment_type === 'dwell' ? '⏱ Dwell' : '⏸ Idle'}
                        {item.start_location_name && item.end_location_name && (
                          <span className="text-muted font-normal"> — {item.start_location_name} → {item.end_location_name}</span>
                        )}
                      </div>
                      <div className="text-helper text-muted mt-0.5 flex items-center gap-3">
                        {item.duration_minutes && <span>{formatMinutes(item.duration_minutes)}</span>}
                        {item.distance_miles && <span>{parseFloat(item.distance_miles).toFixed(1)} mi</span>}
                        {item.avg_speed_mph && <span>Avg {parseFloat(item.avg_speed_mph).toFixed(0)} mph</span>}
                      </div>
                    </>
                  )}
                </div>
                <div className="text-xs text-gray-400 dark:text-slate-500 shrink-0">{formatTime(item._time)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
