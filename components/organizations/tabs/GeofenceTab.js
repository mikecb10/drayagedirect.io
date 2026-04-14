import { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Save, Trash2, Circle, Pentagon } from 'lucide-react';
import { loadGoogleMaps } from '../../../lib/google-maps-loader';
import Button from '../../ui/Button';
import Alert from '../../ui/Alert';

/**
 * GeofenceTab — Google Maps with DrawingManager for circle + polygon geofences.
 *
 * Uses Google's native DrawingManager for reliable vertex placement, preview
 * lines, and editing. Much smoother than custom click/mousemove handlers.
 *
 * Data stored on the organization:
 *   geofence_type: 'circle' | 'polygon' | null
 *   geofence_data: { center: {lat, lng}, radius_meters } or { points: [{lat, lng}] }
 */
export default function GeofenceTab({ organization }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const googleRef = useRef(null);
  const drawingManagerRef = useRef(null);
  const shapeRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [geofenceType, setGeofenceType] = useState(organization.geofence_type || null);
  const [geofenceData, setGeofenceData] = useState(organization.geofence_data || null);
  const [drawMode, setDrawMode] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);

  const address = [
    organization.address_line1, organization.city, organization.state, organization.zip,
  ].filter(Boolean).join(', ');

  // ── Shape management ───────────────────────────────────────
  const clearShape = useCallback(() => {
    if (shapeRef.current) {
      shapeRef.current.setMap(null);
      shapeRef.current = null;
    }
  }, []);

  // Attach edit listeners to a circle
  function attachCircleListeners(circle) {
    circle.addListener('radius_changed', () => {
      setGeofenceData((d) => ({ ...d, radius_meters: Math.round(circle.getRadius()) }));
      setHasChanges(true);
    });
    circle.addListener('center_changed', () => {
      const c = circle.getCenter();
      setGeofenceData((d) => ({ ...d, center: { lat: c.lat(), lng: c.lng() } }));
      setHasChanges(true);
    });
  }

  // Attach edit listeners to a polygon
  function attachPolygonListeners(polygon) {
    function updatePoints() {
      const path = polygon.getPath();
      const pts = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        pts.push({ lat: p.lat(), lng: p.lng() });
      }
      setGeofenceData({ points: pts });
      setHasChanges(true);
    }
    polygon.getPath().addListener('set_at', updatePoints);
    polygon.getPath().addListener('insert_at', updatePoints);
    polygon.getPath().addListener('remove_at', updatePoints);
  }

  // ── Init map + DrawingManager ──────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;

    async function init() {
      try {
        const google = await loadGoogleMaps();
        if (cancelled) return;
        googleRef.current = google;

        // Geocode address
        const geocoder = new google.maps.Geocoder();
        let center = { lat: 39.8283, lng: -98.5795 };
        if (address) {
          try {
            const result = await new Promise((resolve, reject) => {
              geocoder.geocode({ address }, (results, status) => {
                if (status === 'OK' && results[0]) resolve(results[0].geometry.location);
                else reject();
              });
            });
            center = { lat: result.lat(), lng: result.lng() };
          } catch {}
        }

        const map = new google.maps.Map(mapRef.current, {
          zoom: 16, center,
          mapTypeId: 'hybrid',
          disableDefaultUI: false,
          zoomControl: true, mapTypeControl: true,
          streetViewControl: false, fullscreenControl: true,
        });
        mapInstanceRef.current = map;

        // Org marker
        new google.maps.Marker({
          map, position: center, title: organization.name,
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: 8,
            fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2,
          },
        });

        // ── DrawingManager ─────────────────────────────────
        const drawingManager = new google.maps.drawing.DrawingManager({
          drawingMode: null, // start with no drawing
          drawingControl: false, // we use our own buttons
          circleOptions: {
            fillColor: '#2563eb', fillOpacity: 0.15,
            strokeColor: '#2563eb', strokeOpacity: 0.7, strokeWeight: 2,
            editable: true, draggable: true, zIndex: 5,
          },
          polygonOptions: {
            fillColor: '#2563eb', fillOpacity: 0.15,
            strokeColor: '#2563eb', strokeOpacity: 0.7, strokeWeight: 2,
            editable: true, draggable: true, zIndex: 5,
          },
        });
        drawingManager.setMap(map);
        drawingManagerRef.current = drawingManager;

        // When a circle is drawn
        google.maps.event.addListener(drawingManager, 'circlecomplete', (circle) => {
          clearShape();
          shapeRef.current = circle;

          const c = circle.getCenter();
          const data = {
            center: { lat: c.lat(), lng: c.lng() },
            radius_meters: Math.round(circle.getRadius()),
          };
          setGeofenceType('circle');
          setGeofenceData(data);
          setHasChanges(true);
          setDrawMode(null);
          drawingManager.setDrawingMode(null);

          attachCircleListeners(circle);
        });

        // When a polygon is drawn
        google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon) => {
          clearShape();
          shapeRef.current = polygon;

          const path = polygon.getPath();
          const pts = [];
          for (let i = 0; i < path.getLength(); i++) {
            const p = path.getAt(i);
            pts.push({ lat: p.lat(), lng: p.lng() });
          }
          setGeofenceType('polygon');
          setGeofenceData({ points: pts });
          setHasChanges(true);
          setDrawMode(null);
          drawingManager.setDrawingMode(null);

          attachPolygonListeners(polygon);
        });

        // Load existing geofence
        if (organization.geofence_type === 'circle' && organization.geofence_data) {
          const d = organization.geofence_data;
          const circle = new google.maps.Circle({
            map, center: d.center, radius: d.radius_meters,
            fillColor: '#2563eb', fillOpacity: 0.15,
            strokeColor: '#2563eb', strokeOpacity: 0.7, strokeWeight: 2,
            editable: true, draggable: true,
          });
          shapeRef.current = circle;
          attachCircleListeners(circle);
        } else if (organization.geofence_type === 'polygon' && organization.geofence_data?.points) {
          const polygon = new google.maps.Polygon({
            map, paths: organization.geofence_data.points,
            fillColor: '#2563eb', fillOpacity: 0.15,
            strokeColor: '#2563eb', strokeOpacity: 0.7, strokeWeight: 2,
            editable: true, draggable: true,
          });
          shapeRef.current = polygon;
          attachPolygonListeners(polygon);
        }

        setLoading(false);
      } catch (e) {
        if (!cancelled) { setError('Failed to load map'); setLoading(false); }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // ── Sync drawMode → DrawingManager ─────────────────────────
  useEffect(() => {
    const dm = drawingManagerRef.current;
    const google = googleRef.current;
    if (!dm || !google) return;

    if (drawMode === 'circle') {
      dm.setDrawingMode(google.maps.drawing.OverlayType.CIRCLE);
    } else if (drawMode === 'polygon') {
      dm.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
    } else {
      dm.setDrawingMode(null);
    }
  }, [drawMode]);

  // ── Save ───────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/tenant/organizations/${organization.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geofence_type: geofenceType, geofence_data: geofenceData }),
      });
      if (!res.ok) throw new Error('Failed to save geofence');
      setHasChanges(false);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function handleClear() {
    clearShape();
    setGeofenceType(null);
    setGeofenceData(null);
    setHasChanges(true);
    setDrawMode(null);
  }

  function activateDrawMode(mode) {
    if (drawMode === mode) {
      setDrawMode(null);
    } else {
      clearShape();
      setGeofenceType(null);
      setGeofenceData(null);
      setDrawMode(mode);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            Geofence
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Draw a boundary around this location. Driver GPS auto-triggers Arrived/Departed events.
          </p>
        </div>
        <div className="flex gap-2">
          {(geofenceType || hasChanges) && (
            <Button variant="secondary" onClick={handleClear}>
              <Trash2 className="w-4 h-4 mr-1 inline" /> Clear
            </Button>
          )}
          {hasChanges && (
            <Button onClick={handleSave} loading={saving}>
              <Save className="w-4 h-4 mr-1 inline" /> Save Geofence
            </Button>
          )}
        </div>
      </div>

      {/* Drawing tools */}
      <div className="flex items-center gap-3">
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Draw:</div>
        <button type="button" onClick={() => activateDrawMode('circle')}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            drawMode === 'circle'
              ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 ring-2 ring-blue-200 dark:ring-blue-900'
              : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
          }`}>
          <Circle className="w-3.5 h-3.5" /> Circle
        </button>
        <button type="button" onClick={() => activateDrawMode('polygon')}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            drawMode === 'polygon'
              ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 ring-2 ring-blue-200 dark:ring-blue-900'
              : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
          }`}>
          <Pentagon className="w-3.5 h-3.5" /> Polygon
        </button>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {drawMode === 'circle' && 'Click and drag on the map to draw a circle'}
          {drawMode === 'polygon' && 'Click to place points. Double-click to close the shape.'}
          {!drawMode && geofenceType && (geofenceType === 'circle' ? 'Drag to move, pull edge to resize' : 'Drag points to reshape')}
          {!drawMode && !geofenceType && 'Select a shape then draw on the map'}
        </span>
      </div>

      {/* Geofence info bar */}
      {geofenceType === 'circle' && geofenceData && (
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 px-4 py-2 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-4">
          <span><strong>Type:</strong> Circle</span>
          <span><strong>Radius:</strong> {geofenceData.radius_meters}m ({(geofenceData.radius_meters * 3.28084).toFixed(0)} ft)</span>
          <span><strong>Center:</strong> {geofenceData.center?.lat?.toFixed(6)}, {geofenceData.center?.lng?.toFixed(6)}</span>
        </div>
      )}
      {geofenceType === 'polygon' && geofenceData?.points && (
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 px-4 py-2 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-4">
          <span><strong>Type:</strong> Polygon</span>
          <span><strong>Points:</strong> {geofenceData.points.length}</span>
          <span><strong>Area:</strong> ~{computePolygonArea(geofenceData.points)} sq ft</span>
        </div>
      )}

      {/* Map */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden" style={{ height: 500 }}>
        {loading && (
          <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-slate-900 text-sm text-gray-400 dark:text-slate-500">
            Loading map...
          </div>
        )}
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      </div>

      <div className="text-xs text-gray-500 dark:text-slate-400">
        <strong>Address:</strong> {address || 'No address set — add one in the Overview tab'}
      </div>
    </div>
  );
}

// Approximate polygon area in square feet
function computePolygonArea(points) {
  if (!points || points.length < 3) return '0';
  const toRad = (deg) => (deg * Math.PI) / 180;
  const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(toRad(avgLat));
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += (points[i].lng * mPerDegLng) * (points[j].lat * mPerDegLat)
          - (points[j].lng * mPerDegLng) * (points[i].lat * mPerDegLat);
  }
  const sqFt = Math.abs(area) / 2 * 10.7639;
  if (sqFt > 1e6) return `${(sqFt / 1e6).toFixed(1)}M`;
  if (sqFt > 1e3) return `${(sqFt / 1e3).toFixed(1)}K`;
  return sqFt.toFixed(0);
}
