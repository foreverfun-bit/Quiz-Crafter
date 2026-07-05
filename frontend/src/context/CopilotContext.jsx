import { createContext, useCallback, useContext, useMemo, useState } from "react";

const CopilotContext = createContext(null);

export const CopilotProvider = ({ children }) => {
  const [pageContext, setPageContext] = useState({});

  const updatePageContext = useCallback((patch) => {
    setPageContext((current) => ({
      ...current,
      ...(patch && typeof patch === "object" ? patch : {}),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const clearPageContext = useCallback((scope) => {
    setPageContext((current) => {
      if (!scope) return {};
      const next = { ...current };
      delete next[scope];
      return next;
    });
  }, []);

  const value = useMemo(() => ({ pageContext, updatePageContext, clearPageContext }), [pageContext, updatePageContext, clearPageContext]);

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
};

export const useCopilot = () => {
  const context = useContext(CopilotContext);
  if (!context) return { pageContext: {}, updatePageContext: () => {}, clearPageContext: () => {} };
  return context;
};
