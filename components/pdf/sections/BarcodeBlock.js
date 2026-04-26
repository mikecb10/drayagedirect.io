import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * v1: monospace text rendering of the load number bracketed with
 * asterisks (Code 39 start/stop convention). Future iterations may
 * swap in a real barcode (Code 128 SVG via @react-pdf/renderer's
 * Svg component or a precomputed image).
 */
export default function BarcodeBlock({ data }) {
  if (!data?.load_number) return null;
  return (
    <View style={{ marginTop: 8, alignItems: 'center' }}>
      <Text style={[typography.value, { fontFamily: 'Courier', fontSize: 14, letterSpacing: 2 }]}>
        *{data.load_number}*
      </Text>
    </View>
  );
}
