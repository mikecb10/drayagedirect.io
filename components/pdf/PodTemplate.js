import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';
import { buildSectionData } from '../../lib/pdf/build-pod-section-data';

import Header             from './sections/Header';
import PodDetails         from './sections/PodDetails';
import AddressDetails     from './sections/AddressDetails';
import OrderDetails       from './sections/OrderDetails';
import CommodityDetails   from './sections/CommodityDetails';
import AttachedDocuments  from './sections/AttachedDocuments';
import Notes              from './sections/Notes';
import Signature          from './sections/Signature';
import Disclaimer         from './sections/Disclaimer';
import MoveBlock          from './sections/MoveBlock';
import DocumentFooter     from './sections/DocumentFooter';

// Re-export buildSectionData for any consumer that imports from this path.
export { buildSectionData } from '../../lib/pdf/build-pod-section-data';

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
    case 'pod_details':
      return <PodDetails data={sectionData.pod_details} opts={opts} colors={colors} />;
    case 'address_details': {
      // Field-ID translation: POD_SECTIONS uses `bill_to`; AddressDetails reads
      // `opts.fields.customer` internally. Per-doc-type "Bill To" label is
      // supplied via opts.customerLabel here. Mirrored in
      // components/settings/document-designer/preview/DocumentPreview.js for
      // the live HTML preview path — keep the two in sync.
      const addrOpts = {
        ...opts,
        customerLabel: 'Bill To',
        fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
      };
      return <AddressDetails data={sectionData.address_details} opts={addrOpts} colors={colors} />;
    }
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
    case 'attached_documents':
      return <AttachedDocuments data={sectionData.attached_documents} opts={opts} colors={colors} />;
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

export default function PodTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('pod');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = { variant: 'pod', title: 'PROOF OF DELIVERY', subtitle: null };

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
