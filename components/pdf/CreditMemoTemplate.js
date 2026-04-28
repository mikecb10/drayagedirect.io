import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';
import { buildSectionData } from '../../lib/pdf/build-credit-memo-section-data';

import Header             from './sections/Header';
import CreditMemoDetails  from './sections/CreditMemoDetails';
import AddressDetails     from './sections/AddressDetails';
import Reason             from './sections/Reason';
import IssuedFromInvoice  from './sections/IssuedFromInvoice';
import AppliedToInvoice   from './sections/AppliedToInvoice';
import CreditAmountPanel  from './sections/CreditAmountPanel';
import Notes              from './sections/Notes';
import Disclaimer         from './sections/Disclaimer';
import DocumentFooter     from './sections/DocumentFooter';
import VoidWatermark      from './sections/VoidWatermark';

// Re-export buildSectionData for any consumer that imports from this path.
export { buildSectionData } from '../../lib/pdf/build-credit-memo-section-data';

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
    case 'memo_details':
      return <CreditMemoDetails data={sectionData.memo_details} opts={opts} colors={colors} />;
    case 'address_details': {
      // Field-ID translation: CREDIT_MEMO_SECTIONS uses `bill_to`; AddressDetails reads
      // `opts.fields.customer` internally. Per-doc-type "Bill To" label is supplied via
      // opts.customerLabel here. Mirrored in DocumentPreview.js for the live HTML
      // preview path — keep the two in sync. (Same translation as Statement.)
      const addrOpts = {
        ...opts,
        customerLabel: 'Bill To',
        fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
      };
      return <AddressDetails data={sectionData.address_details} opts={addrOpts} colors={colors} />;
    }
    case 'reason':
      // Data-driven auto-hide: composer returns null when reason data is missing,
      // independent of Designer toggle (per spec §7.7).
      return doc.memo_meta?.reason && sectionData.reason
        ? <Reason data={sectionData.reason} colors={colors} />
        : null;
    case 'issued_from_invoice':
      return doc.issued_from_invoice && sectionData.issued_from_invoice
        ? <IssuedFromInvoice data={sectionData.issued_from_invoice} opts={opts} colors={colors} />
        : null;
    case 'applied_to_invoice':
      return doc.applied_to_invoice && sectionData.applied_to_invoice
        ? <AppliedToInvoice data={sectionData.applied_to_invoice} opts={opts} colors={colors} />
        : null;
    case 'credit_amount':
      return <CreditAmountPanel data={sectionData.credit_amount} opts={opts} colors={colors} />;
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

export default function CreditMemoTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('credit_memo');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = {
    variant: 'credit_memo',
    title: 'CREDIT MEMO',
    subtitle: doc.memo_meta?.memo_number || '',
  };

  return (
    <Document>
      <Page size="LETTER" style={typography.page} wrap>
        {/* VOID watermark layered behind/over the section body for void-status memos.
            <View fixed> ensures it replicates on every page if the doc overflows
            (long notes/disclaimer pushing onto page 2). Hardcoded — not section-toggleable. */}
        {doc.is_void && <VoidWatermark />}
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
