/**
 * ChargeProfileDetail — Overlay wrapper for the Charge Profile form.
 *
 * Imports the page component and renders it in overlay mode
 * (without SettingsLayout wrapper) by passing onClose prop.
 */
import ChargeProfileForm from '../../pages/settings/charge-profiles/[id]';

export default function ChargeProfileDetail({ chargeProfileId, onClose }) {
  return <ChargeProfileForm chargeProfileId={chargeProfileId} onClose={onClose} />;
}
