import { StyleSheet } from '@react-pdf/renderer';

// Minimal default styling — intentionally plain. The document
// designer sub-project (future) will replace all of this with
// tenant-authored templates.
export const colors = {
  text: '#000000',
  muted: '#666666',
  border: '#cccccc',
  tableHeader: '#f3f4f6',
};

export const typography = StyleSheet.create({
  page: {
    padding: 36, // 0.5" margin
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: colors.text,
  },
  h1: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  h2: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  label: {
    fontSize: 9,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  value: {
    fontSize: 10,
    marginBottom: 6,
  },
  muted: {
    color: colors.muted,
  },
});
