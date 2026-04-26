import { View, Text, Image } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Header section. Renders tenant identity (logo + company name + address +
 * phone + website) on the left, document title + subtitle on the right.
 *
 * `opts.fields`: { logo, address, phone, website, company_name }.
 * Default-true for any field not specified, except `website` which defaults
 * to false (matches registry).
 *
 * In FU-035-D the data subset for new fields (logo URL, address, phone,
 * website) is mostly null — the toggles exist but render nothing without
 * data. FU-035-D2 / FU-035-F adds the data wiring.
 */
export default function Header({ tenantName, title, subtitle, contactLine, tenantInfo, opts }) {
  const fields = opts?.fields || {};
  const showLogo        = fields.logo        !== false;
  const showAddress     = fields.address     !== false;
  const showPhone       = fields.phone       !== false;
  const showWebsite     = fields.website === true; // defaultVisible: false
  const showCompanyName = fields.company_name !== false;

  const logoUrl = tenantInfo?.logo_url;
  const address = tenantInfo?.address;
  const phone   = tenantInfo?.phone;
  const website = tenantInfo?.website;

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        {showLogo && logoUrl ? (
          <Image src={logoUrl} style={{ width: 60, height: 60, objectFit: 'contain' }} />
        ) : null}
        <View>
          {showCompanyName ? (
            <Text style={typography.h2}>{tenantName || 'Company'}</Text>
          ) : null}
          {showAddress && address ? (
            <Text style={typography.muted}>{address}</Text>
          ) : null}
          {showPhone && phone ? (
            <Text style={typography.muted}>{phone}</Text>
          ) : null}
          {showWebsite && website ? (
            <Text style={typography.muted}>{website}</Text>
          ) : null}
          {/* Legacy contactLine kept for back-compat with callers that pass it pre-D2. */}
          {contactLine && !address && !phone ? (
            <Text style={typography.muted}>{contactLine}</Text>
          ) : null}
        </View>
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
