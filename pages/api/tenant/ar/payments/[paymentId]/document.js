import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { getSignedUrl } from '../../../../../../lib/pdf/storage';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

// Disable Next's body parser — formidable handles multipart.
export const config = {
  runtime: 'nodejs',
  api: { bodyParser: false },
};

const BUCKET = 'documents';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

/**
 * /api/tenant/ar/payments/[paymentId]/document
 *
 *   POST   — upload a supporting document (check scan, wire confirmation,
 *            ACH receipt). Multipart form with a single `file` field.
 *            Stores in Storage bucket `documents` at
 *            `{tenantId}/payments/{paymentId}{ext}` and stamps
 *            payments_received.document_url + document_filename.
 *            Re-upload replaces the prior doc (upsert + URL points at the
 *            new path; the old path is orphaned and will age out with
 *            bucket lifecycle policy — fine for low-volume payment docs).
 *
 *   GET    — returns a 15-min signed URL for the stored document. Caller
 *            can fetch JSON { url, filename } or follow ?redirect=1 for
 *            a 302 into the signed URL (convenient for inline <a href>).
 *
 *   DELETE — removes the document reference from the row and deletes the
 *            file from Storage. Does NOT delete the payment itself.
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { paymentId } = req.query;
  const svc = getServiceClient();

  // Verify payment exists and belongs to this tenant before any mutation
  // or file access. Prevents tenant A from reading/writing tenant B's doc
  // by guessing payment IDs.
  const { data: payment, error: payErr } = await svc
    .from('payments_received')
    .select('id, document_url, document_filename')
    .eq('id', paymentId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (payErr) return res.status(500).json({ error: payErr.message });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  if (req.method === 'POST') {
    try {
      const form = formidable({ maxFileSize: MAX_BYTES });
      const [, files] = await form.parse(req);
      const file = files.file?.[0] || files.file;
      if (!file) return res.status(400).json({ error: 'No file uploaded' });

      const originalName = file.originalFilename || file.newFilename || 'document';
      const ext = (path.extname(originalName) || '').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        return res.status(400).json({ error: `File type ${ext || '(none)'} not allowed. PDF, PNG, JPG only.` });
      }
      const mime = file.mimetype || 'application/octet-stream';
      if (!ALLOWED_MIME.has(mime)) {
        return res.status(400).json({ error: `Content-Type ${mime} not allowed. PDF, PNG, JPG only.` });
      }

      const filePath = file.filepath || file.path;
      const buffer = fs.readFileSync(filePath);

      const storagePath = `${ctx.tenantId}/payments/${paymentId}${ext}`;
      const { error: uploadErr } = await svc.storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType: mime, upsert: true });
      if (uploadErr) return res.status(500).json({ error: `Upload failed: ${uploadErr.message}` });

      const { error: updErr } = await svc
        .from('payments_received')
        .update({
          document_url: storagePath,
          document_filename: originalName,
        })
        .eq('id', paymentId)
        .eq('tenant_id', ctx.tenantId);
      if (updErr) return res.status(500).json({ error: `DB update failed: ${updErr.message}` });

      try { fs.unlinkSync(filePath); } catch {}

      return res.status(200).json({
        document_url: storagePath,
        document_filename: originalName,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Upload failed' });
    }
  }

  if (req.method === 'GET') {
    if (!payment.document_url) return res.status(404).json({ error: 'No document attached' });
    try {
      const signedUrl = await getSignedUrl(svc, payment.document_url);
      if (req.query.redirect === '1') {
        res.writeHead(302, { Location: signedUrl });
        return res.end();
      }
      return res.status(200).json({ url: signedUrl, filename: payment.document_filename });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Signed URL generation failed' });
    }
  }

  if (req.method === 'DELETE') {
    if (!payment.document_url) return res.status(200).json({ ok: true });
    try {
      await svc.storage.from(BUCKET).remove([payment.document_url]);
    } catch { /* non-fatal — row-clear is the source of truth */ }
    const { error: updErr } = await svc
      .from('payments_received')
      .update({ document_url: null, document_filename: null })
      .eq('id', paymentId)
      .eq('tenant_id', ctx.tenantId);
    if (updErr) return res.status(500).json({ error: updErr.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
