import AdvancedRouteBuilder from '../shared/AdvancedRouteBuilder';

/**
 * TariffAdvancedRoutePanel — thin AR wrapper around the shared
 * AdvancedRouteBuilder. Exists so the AR page imports a route-
 * specific symbol even if the underlying component is shared.
 *
 * Mirror on the AP side: DriverTariffAdvancedRoutePanel.
 */
export default function TariffAdvancedRoutePanel({ value, onChange, routingTemplates }) {
  return (
    <AdvancedRouteBuilder
      value={value}
      onChange={onChange}
      routingTemplates={routingTemplates}
    />
  );
}
