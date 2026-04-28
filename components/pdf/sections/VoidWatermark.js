import { View, Text } from '@react-pdf/renderer';

const styles = {
  // The overlay sits inside <Page>'s body. position: 'absolute' centers it.
  // `fixed` (passed as prop on the View) tells React-PDF to replicate it
  // on every page if the doc wraps to multiple pages.
  overlay: {
    position: 'absolute',
    top: '40%',         // approximate vertical center allowing for the rotation
    left: '15%',        // pull leftward so the rotated rectangle sits centered
    transform: 'rotate(-22deg)',
    paddingHorizontal: 22,
    paddingVertical: 4,
    borderWidth: 4,
    borderColor: 'rgba(220, 38, 38, 0.18)',
    borderRadius: 6,
    width: '70%',
    alignItems: 'center',
  },
  text: {
    fontSize: 100,
    fontWeight: 900,
    color: 'rgba(220, 38, 38, 0.18)',
    letterSpacing: 8,
    textAlign: 'center',
  },
};

/**
 * Diagonal "VOID" watermark for status='void' credit memos. Hardcoded —
 * not toggleable in Designer (per spec §3.5 + §10.6).
 *
 * Rendered inside <Page> body (NOT inside the section dispatch). The composer
 * is responsible for placing this conditionally:
 *
 *   <Page wrap>
 *     {doc.is_void && <VoidWatermark />}
 *     {sections.map(...)}
 *   </Page>
 *
 * The `fixed` attribute on the outer View tells React-PDF to replicate this
 * on every page if the doc overflows (long notes/disclaimer pushing onto
 * page 2). Without `fixed`, the watermark would only appear on page 1.
 */
export default function VoidWatermark() {
  return (
    <View fixed style={styles.overlay}>
      <Text style={styles.text}>VOID</Text>
    </View>
  );
}
