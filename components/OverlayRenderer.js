import dynamic from 'next/dynamic';
import { useOverlay } from '../contexts/OverlayContext';
import OverlayPanel from './ui/OverlayPanel';

// Dynamic imports to avoid loading huge form components until needed
const LoadDetail = dynamic(() => import('./loads/LoadDetail'), { ssr: false });
const TariffDetail = dynamic(() => import('./settings/TariffDetail'), { ssr: false });
const ChargeProfileDetail = dynamic(() => import('./settings/ChargeProfileDetail'), { ssr: false });

/**
 * OverlayRenderer — Reads the overlay stack and renders the correct content
 * component inside an OverlayPanel for each entry.
 *
 * Mounted as a sibling to <Component /> in _app.js so the underlying page
 * stays mounted (preserving all state) while overlays are shown on top.
 */
export default function OverlayRenderer() {
  const { stack, closeOverlay } = useOverlay();

  if (stack.length === 0) return null;

  return (
    <>
      {stack.map((entry, index) => (
        <OverlayPanel key={entry.id} onClose={closeOverlay} stackIndex={index} closing={entry.closing}>
          {entry.type === 'load' && (
            <LoadDetail
              loadId={entry.props.loadId}
              initialTab={entry.props.tab || 'info'}
              onClose={closeOverlay}
            />
          )}
          {entry.type === 'tariff' && (
            <TariffDetail
              tariffId={entry.props.tariffId}
              onClose={closeOverlay}
            />
          )}
          {entry.type === 'chargeProfile' && (
            <ChargeProfileDetail
              chargeProfileId={entry.props.chargeProfileId}
              onClose={closeOverlay}
            />
          )}
        </OverlayPanel>
      ))}
    </>
  );
}
