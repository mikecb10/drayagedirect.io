import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';
import { buildSectionData } from '../../lib/pdf/build-rate-con-section-data';

import Header             from './sections/Header';
import RateConDetails     from './sections/RateConDetails';
import AddressDetails     from './sections/AddressDetails';
import OrderDetails       from './sections/OrderDetails';
import CommodityDetails   from './sections/CommodityDetails';
import ChargeDetails      from './sections/ChargeDetails';
import Notes              from './sections/Notes';
import Signature          from './sections/Signature';
import Disclaimer         from './sections/Disclaimer';
import MoveBlock          from './sections/MoveBlock';
import DocumentFooter     from './sections/DocumentFooter';

// Re-export buildSectionData for any consumer that imports from this path.
// New consumers should import directly from lib/pdf/build-rate-con-section-data.
export { buildSectionData } from '../../lib/pdf/build-rate-con-section-data';

function renderSection(sectionId, doc, sectionData, opts, ctx, colors) {
  switch (sectionId) {
    case 'header':
      return (
        <Header
          tenantName={sectionData.header.tenantName}
          tenantInfo={sectionData.header.tenantInfo}
          title={ctx.title}
          subtitle={ctx.subtitle}
          opts={opts}
          colors={colors}
        />
      );
    case 'rate_con_details':
      return <RateConDetails data={sectionData.rate_con_details} opts={opts} colors={colors} />;
    case 'address_details':
      // Rate Con's address_details registry has no `customer` or `bill_to` field
      // (only the 4 location fields), so no field-ID translation is needed.
      // buildSectionData sets data.customer = null so AddressDetails's customer
      // block short-circuits regardless of opts.fields.
      return <AddressDetails data={sectionData.address_details} opts={opts} colors={colors} />;
    case 'order_details':
      return <OrderDetails data={sectionData.order_details} opts={opts} colors={colors} />;
    case 'move_events':
      return (
        <MoveBlock
          data={{ moves: doc.moves }}
          opts={opts}
          isNextMoveOnly={false}
          totalMoves={doc.moves?.length ?? 0}
        />
      );
    case 'commodity_details':
      return <CommodityDetails data={sectionData.commodity_details} opts={opts} colors={colors} />;
    case 'charge_details': {
      // Rate Con's charge_set.total_cents is the only authoritative total.
      // No subtotal_cents column → suppress the Subtotal row in the totals footer.
      // Mirrored in components/settings/document-designer/preview/DocumentPreview.js
      // for the live HTML preview path — keep the two in sync.
      const chargeOpts = { ...opts, showSubtotal: false };
      return <ChargeDetails data={sectionData.charge_details} opts={chargeOpts} colors={colors} />;
    }
    case 'notes':
      return <Notes data={sectionData.notes} opts={opts} />;
    case 'signature':
      return <Signature data={sectionData.signature} colors={colors} />;
    case 'disclaimer':
      return <Disclaimer data={sectionData.disclaimer} colors={colors} />;
    case 'footer':
      return <DocumentFooter data={{ tenant_name: doc.tenant_name }} />;
    default:
      return null;
  }
}

export default function RateConTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('rate_con');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = { variant: 'rate_con', title: 'RATE CONFIRMATION', subtitle: null };

  return (
    <Document>
      <Page size="LETTER" style={typography.page} wrap>
        {order.map((sectionId) => {
          if (!visibility[sectionId]) return null;
          const baseOpts = sectionConfig?.perSection?.[sectionId] || {};
          const opts = { ...baseOpts, fields: fields[sectionId] || {} };
          const node = renderSection(sectionId, doc, sectionData, opts, ctx, colors);
          return node ? <React.Fragment key={sectionId}>{node}</React.Fragment> : null;
        })}
      </Page>
    </Document>
  );
}
