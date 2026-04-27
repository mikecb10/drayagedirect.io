import { View, Text } from '@react-pdf/renderer';
import { colors as defaultColors } from '../shared/typography';

const styles = {
  section: { marginBottom: 12 },
  band: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginBottom: 4,
  },
  bandText: {
    color: 'white',
    fontSize: 7,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: defaultColors.tableHeader,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: defaultColors.border,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: defaultColors.border,
  },
  cellName: { flex: 3, fontSize: 9 },
  cellDate: { flex: 1, fontSize: 9 },
  headerText: {
    fontWeight: 'bold',
    fontSize: 8,
    color: defaultColors.muted,
    textTransform: 'uppercase',
  },
  emptyRow: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    color: defaultColors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    fontSize: 10,
  },
};

/**
 * Attached Documents section — list of POD-typed files from order_documents.
 *   Header band (accent-color) + 2-column table: File Name | Uploaded.
 *
 * `data` shape: Array<{ id, file_name, document_type, uploaded_at }>
 *   uploaded_at is pre-formatted by fetchPodData (string).
 *
 * v1 lists files only; embedding image thumbnails is a future enhancement
 * (FU-035-H4-followup-C).
 */
export default function AttachedDocuments({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const accent = colors?.accent || '#3B82F6';

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Attached Documents</Text>
      </View>

      <View style={styles.headerRow}>
        <Text style={[styles.cellName, styles.headerText]}>File Name</Text>
        <Text style={[styles.cellDate, styles.headerText]}>Uploaded</Text>
      </View>

      {data.length === 0 ? (
        <Text style={styles.emptyRow}>(No attached documents)</Text>
      ) : (
        data.map((doc, idx) => (
          <View key={doc.id || idx} style={styles.row}>
            <Text style={styles.cellName}>{doc.file_name || '—'}</Text>
            <Text style={styles.cellDate}>{doc.uploaded_at || '—'}</Text>
          </View>
        ))
      )}
    </View>
  );
}
