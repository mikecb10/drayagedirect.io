import { useState, useCallback } from 'react';

export function useEmailCompose() {
  const [state, setState] = useState({ isOpen: false, docType: null, contextId: null });

  const open = useCallback((docType, contextId) => {
    setState({ isOpen: true, docType, contextId });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, docType: null, contextId: null });
  }, []);

  return { ...state, open, close };
}
