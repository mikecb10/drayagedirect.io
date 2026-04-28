import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';
import { buildSectionData } from '../../lib/pdf/build-statement-section-data';

import Header             from './sections/Header';
import StatementDetails   from './sections/StatementDetails';
import AddressDetails     from './sections/AddressDetails';
import OpenInvoicesTable  from './sections/OpenInvoicesTable';
import AgingSummary       from './sections/AgingSummary';
import TotalOutstanding   from './sections/TotalOutstanding';
import Notes              from './sections/Notes';
import Disclaimer         from './sections/Disclaimer';
import DocumentFooter     from './sections/DocumentFooter';

// Re-export buildSectionData for any consumer that imports from this path.
export { buildSectionData } from '../../lib/pdf/build-statement-section-data';

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
    case 'statement_details':
      return <StatementDetails data={sectionData.statement_details} opts={opts} colors={colors} />;
    case 'address_details': {
      // Field-ID translation: STATEMENT_SECTIONS uses `bill_to`; AddressDetails reads
      // `opts.fields.customer` internally. Per-doc-type "Bill To" label is supplied via
      // opts.customerLabel here. Mirrored in DocumentPreview.js for the live HTML
      // preview path — keep the two in sync.
      const addrOpts = {
        ...opts,
        customerLabel: 'Bill To',
        fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
      };
      return <AddressDetails data={sectionData.address_details} opts={addrOpts} colors={colors} />;
    }
    case 'open_invoices':
      return <OpenInvoicesTable data={sectionData.open_invoices} opts={opts} colors={colors} />;
    case 'aging_summary':
      return <AgingSummary data={sectionData.aging_summary} opts={opts} colors={colors} />;
    case 'total_outstanding':
      return <TotalOutstanding data={sectionData.total_outstanding} opts={opts} colors={colors} />;
    case 'notes':
      return <Notes data={sectionData.notes} opts={opts} />;
    case 'disclaimer':
      return <Disclaimer data={sectionData.disclaimer} colors={colors} />;
    case 'footer':
      return <DocumentFooter data={{ tenant_name: doc.tenant_name }} />;
    default:
      return null;
  }
}

export default function StatementTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('statement');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = { variant: 'statement', title: 'STATEMENT', subtitle: 'OF ACCOUNT' };

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
