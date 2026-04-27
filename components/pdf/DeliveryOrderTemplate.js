import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import Header from './sections/Header';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';
import DeliveryOrderDetails from './sections/DeliveryOrderDetails';
import AddressDetails from './sections/AddressDetails';
import OrderDetails from './sections/OrderDetails';
import Notes from './sections/Notes';
import CommodityDetails from './sections/CommodityDetails';
import Signature from './sections/Signature';
import Disclaimer from './sections/Disclaimer';
import MoveBlock from './sections/MoveBlock';
import BarcodeBlock from './sections/BarcodeBlock';
import DocumentFooter from './sections/DocumentFooter';

/**
 * Build the per-section data subsets the new components expect from the
 * shared `doc` payload. In FU-035-D, this is mostly a re-shape of the
 * data the old per-section components received; new fields with no data
 * source today (logo, locations, weight, etc.) are passed as null.
 */
function buildSectionData(doc) {
  const lm = doc.load_metadata || {};
  const eq = doc.equipment_details || {};
  const ap = doc.appointment_details || {};
  const hz = doc.hazmat_details || {};
  const inst = doc.instructions || {};
  const firstMove = (doc.moves || [])[0] || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},  // logo_url / address / phone / website — populated in D2/F
    },
    delivery_order_details: {
      delivery_order_number: lm.load_number,
      pickup_number:         eq.pickup_number,
      driver_name:           firstMove.driver_name,
      delivery_appointment:  ap.delivery_appt_number,
      reference_number:      lm.customer_reference,
    },
    address_details: {
      customer: doc.bill_to ? {
        name:          doc.bill_to.name,
        address_line1: doc.bill_to.address_line1,
        city:          doc.bill_to.city,
        state:         doc.bill_to.state,
        zip:           doc.bill_to.zip,
        phone:         doc.customer_contact?.phone,
        email:         doc.customer_contact?.email,
      } : null,
      pickup_location:   doc.load_level_locations?.pickup_location   || null,
      delivery_location: doc.load_level_locations?.delivery_location || null,
      return_location:   doc.load_level_locations?.return_location   || null,
      appointment_times: {
        pickup:   ap.pickup_appt_number,
        delivery: ap.delivery_appt_number,
      },
      is_operational_street_turn: doc.is_operational_street_turn || false,
    },
    order_details: {
      reference_number:      lm.customer_reference,
      booking_bl:            eq.booking_number || eq.bl_number,
      mbol:                  eq.mbol_number,
      hbol:                  eq.hbol_number,
      container_number:      eq.container_number || lm.container_number,
      container_size:        eq.container_size,
      container_type:        eq.container_type,
      chassis_number:        eq.chassis_number || lm.chassis_number,
      chassis_size:          eq.chassis_size,
      chassis_type:          eq.chassis_type,
      chassis_owner:         eq.chassis_owner,
      steamship_line:        eq.steamship_line,
      seal:                  eq.seal_number,
      hazmat:                hz.hazmat_class ? `${hz.un_code || ''} ${hz.hazmat_class}`.trim() : null,
      pickup_number:         eq.pickup_number,
      pull_container_date:   ap.pull_container_date,
      return_container_date: ap.return_container_date,
      last_free_day:         ap.last_free_day,
      per_diem_free_day:     ap.per_diem_free_day,
    },
    notes: {
      driver_notes:   inst.driver_notes,
      yard_notes:     null, // future data-layer FU
      customer_notes: null, // future
      billing_notes:  null, // future
      load_notes:     inst.special_instructions,
    },
    commodity_details: null,  // No real source yet — preview uses sample-data; print stays empty.
    signature: {
      print_name: '',
      signature: '',
      date: '',
      time_in: '',
      time_out: '',
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}

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
    case 'delivery_order_details':
      return <DeliveryOrderDetails data={sectionData.delivery_order_details} opts={opts} />;
    case 'address_details':
      return <AddressDetails data={sectionData.address_details} opts={opts} colors={colors} />;
    case 'order_details':
      return <OrderDetails data={sectionData.order_details} opts={opts} colors={colors} />;
    case 'move_events':
      return (
        <MoveBlock
          data={{ moves: doc.moves }}
          opts={opts}
          isNextMoveOnly={ctx.variant === 'delivery_order_next_move'}
          totalMoves={doc.total_moves_in_load}
        />
      );
    case 'commodity_details': return <CommodityDetails data={sectionData.commodity_details} opts={opts} colors={colors} />;
    case 'notes':              return <Notes data={sectionData.notes} opts={opts} />;
    case 'signature':          return <Signature data={sectionData.signature} colors={colors} />;
    case 'disclaimer':         return <Disclaimer data={sectionData.disclaimer} colors={colors} />;
    case 'barcode':            return <BarcodeBlock data={doc.load_metadata} />;
    case 'footer':             return <DocumentFooter data={{ tenant_name: doc.tenant_name }} />;
    default:                   return null;
  }
}

export default function DeliveryOrderTemplate({
  docs,
  variant,
  sectionConfig,
  perDocSectionConfigs,
}) {
  const registrySections = getSectionsForDocumentType(variant);

  return (
    <Document>
      {(docs || []).map((doc, idx) => {
        const cfg = perDocSectionConfigs?.[idx] ?? sectionConfig;
        const { visibility, fields } = computeVisibility(registrySections, cfg);
        const colors = extractColors(cfg);
        const order = cfg?.order || registrySections.map((s) => s.id);
        const sectionData = buildSectionData(doc);

        const ctx = {
          variant,
          title: 'DELIVERY ORDER',
          subtitle: variant === 'delivery_order_next_move' ? 'Next Move' : null,
        };

        return (
          <Page key={doc.order_id} size="LETTER" style={typography.page} wrap>
            {order.map((sectionId) => {
              if (!visibility[sectionId]) return null;
              const baseOpts = cfg?.perSection?.[sectionId] || {};
              const opts = { ...baseOpts, fields: fields[sectionId] || {} };
              // move_events still wants the legacy show_driver flag for now —
              // in D, it's controlled by delivery_order_details.fields.driver_name
              // (the visible toggle). Wire it through:
              if (sectionId === 'move_events') {
                opts.show_driver = fields.delivery_order_details?.driver_name !== false;
              }
              const node = renderSection(sectionId, doc, sectionData, opts, ctx, colors);
              return node ? <React.Fragment key={sectionId}>{node}</React.Fragment> : null;
            })}
          </Page>
        );
      })}
    </Document>
  );
}
