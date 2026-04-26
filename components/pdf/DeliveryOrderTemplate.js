import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import Header from './shared/Header';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
} from '../../lib/constants/document-sections';
import LoadMetadata from './sections/LoadMetadata';
import BillTo from './sections/BillTo';
import CustomerContact from './sections/CustomerContact';
import EquipmentDetails from './sections/EquipmentDetails';
import HazmatDetails from './sections/HazmatDetails';
import Instructions from './sections/Instructions';
import AppointmentDetails from './sections/AppointmentDetails';
import MoveBlock from './sections/MoveBlock';
import SignatureBlock from './sections/SignatureBlock';
import BarcodeBlock from './sections/BarcodeBlock';
import DocumentFooter from './sections/DocumentFooter';

/**
 * Maps section ID -> render function. New sections plug in by
 * adding an entry here and to the registry in
 * lib/constants/document-sections.js.
 */
function renderSection(sectionId, doc, opts, ctx) {
  switch (sectionId) {
    case 'load_metadata':       return <LoadMetadata data={doc.load_metadata} />;
    case 'bill_to':             return <BillTo data={doc.bill_to} />;
    case 'customer_contact':    return <CustomerContact data={doc.customer_contact} />;
    case 'equipment_details':   return <EquipmentDetails data={doc.equipment_details} opts={opts} />;
    case 'hazmat_details':      return <HazmatDetails data={doc.hazmat_details} />;
    case 'instructions':        return <Instructions data={doc.instructions} />;
    case 'appointment_details': return <AppointmentDetails data={doc.appointment_details} />;
    case 'move_block':
      return (
        <MoveBlock
          data={{ moves: doc.moves }}
          opts={opts}
          isNextMoveOnly={ctx.variant === 'delivery_order_next_move'}
          totalMoves={doc.total_moves_in_load}
        />
      );
    case 'driver_per_move':
      // Driver display is controlled inside MoveBlock via opts; the registry
      // entry exists so the Document Designer can toggle "show driver name".
      return null;
    case 'signature_block':     return <SignatureBlock />;
    case 'barcode':             return <BarcodeBlock data={doc.load_metadata} />;
    case 'footer':              return <DocumentFooter data={{ tenant_name: doc.tenant_name }} />;
    default:                    return null;
  }
}

export default function DeliveryOrderTemplate({ docs, variant, sectionConfig }) {
  const registrySections = getSectionsForDocumentType(variant);
  const visibility = computeVisibility(registrySections, sectionConfig);
  const order = sectionConfig?.order || registrySections.map((s) => s.id);

  // driver_per_move is a registry-level toggle but physically renders inside
  // MoveBlock; thread it through opts so the Designer can hide driver names
  // without restructuring the routing block.
  const moveOpts = {
    ...(sectionConfig?.perSection?.move_block || {}),
    show_driver: visibility.driver_per_move,
  };

  return (
    <Document>
      {(docs || []).map((doc) => (
        <Page key={doc.order_id} size="LETTER" style={typography.page} wrap>
          <Header
            tenantName={doc.tenant_name}
            title="DELIVERY ORDER"
            subtitle={variant === 'delivery_order_next_move' ? 'Next Move' : null}
          />
          {order.map((sectionId) => {
            if (!visibility[sectionId]) return null;
            const opts =
              sectionId === 'move_block'
                ? moveOpts
                : sectionConfig?.perSection?.[sectionId];
            const node = renderSection(sectionId, doc, opts, { variant });
            return node ? <React.Fragment key={sectionId}>{node}</React.Fragment> : null;
          })}
        </Page>
      ))}
    </Document>
  );
}
