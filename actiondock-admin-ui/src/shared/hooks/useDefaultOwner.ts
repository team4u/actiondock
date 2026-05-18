import { useEffect, useState } from "react";
import { getConfigValue } from "../../features/settings/api";

const DEFAULT_OWNER_KEY = "system.default-owner";

export function useDefaultOwner(): string {
  const [owner, setOwner] = useState("");

  useEffect(() => {
    getConfigValue(DEFAULT_OWNER_KEY)
      .then((config) => setOwner(config.value ?? ""))
      .catch(() => {});
  }, []);

  return owner;
}
