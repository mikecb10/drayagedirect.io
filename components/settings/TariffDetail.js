/**
 * TariffDetail — Overlay wrapper for the Tariff form.
 *
 * Imports the page component and renders it in overlay mode
 * (without SettingsLayout wrapper) by passing onClose prop.
 */
import TariffForm from '../../pages/settings/tariffs/[id]';

export default function TariffDetail({ tariffId, onClose }) {
  return <TariffForm tariffId={tariffId} onClose={onClose} />;
}
