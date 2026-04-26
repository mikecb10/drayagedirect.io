import { View, Text } from '@react-pdf/renderer';
import { typography } from './typography';

/**
 * Header renders the tenant name + document title side by side.
 * Optional subtitle renders below the title (used e.g. for
 * "Next Move" on the Delivery Order variant).
 * No logo in 2a.1 — the document designer sub-project will add
 * logo support later.
 */
export default function Header({ tenantName, title, contactLine, subtitle }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
      <View>
        <Text style={typography.h2}>{tenantName || 'Company'}</Text>
        {contactLine ? <Text style={typography.muted}>{contactLine}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={typography.h1}>{title}</Text>
        {subtitle ? (
          <Text style={[typography.value, typography.muted, { marginTop: 2 }]}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}
