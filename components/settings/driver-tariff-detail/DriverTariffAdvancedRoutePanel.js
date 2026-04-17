import AdvancedRouteBuilder from '../shared/AdvancedRouteBuilder';

/**
 * DriverTariffAdvancedRoutePanel — thin AP wrapper around the shared
 * AdvancedRouteBuilder. Exists so the AP page imports a route-specific
 * symbol even if the underlying component is shared with AR.
 */
export default function DriverTariffAdvancedRoutePanel({ value, onChange, routingTemplates }) {
  return (
    <AdvancedRouteBuilder
      value={value}
      onChange={onChange}
      routingTemplates={routingTemplates}
    />
  );
}
