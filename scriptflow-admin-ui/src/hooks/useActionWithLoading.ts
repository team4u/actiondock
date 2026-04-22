import { useState } from "react";

export function useActionWithLoading() {
  const [actionId, setActionId] = useState<string | null>(null);

  const withAction = async (id: string, action: () => Promise<void>) => {
    setActionId(id);
    try {
      await action();
    } finally {
      setActionId(null);
    }
  };

  return { actionId, withAction };
}
