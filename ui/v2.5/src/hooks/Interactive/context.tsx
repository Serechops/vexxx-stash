import React, { useCallback, useContext, useEffect, useState } from "react";
import { useConfigurationContext } from "../Config";
import { useLocalForage } from "../LocalForage";
import { IUIConfig } from "src/core/config";
import { Interactive as InteractiveAPI } from "./interactive";
import { LocalHandyInteractive } from "./local-handy";
import InteractiveUtils, {
  IInteractiveClient,
  IInteractiveClientProvider,
} from "./utils";

export enum ConnectionState {
  Missing,
  Disconnected,
  Error,
  Connecting,
  Syncing,
  Uploading,
  Ready,
}

export function connectionStateLabel(s: ConnectionState) {
  const prefix = "handy_connection_status";
  switch (s) {
    case ConnectionState.Missing:
      return `${prefix}.missing`;
    case ConnectionState.Connecting:
      return `${prefix}.connecting`;
    case ConnectionState.Disconnected:
      return `${prefix}.disconnected`;
    case ConnectionState.Error:
      return `${prefix}.error`;
    case ConnectionState.Syncing:
      return `${prefix}.syncing`;
    case ConnectionState.Uploading:
      return `${prefix}.uploading`;
    case ConnectionState.Ready:
      return `${prefix}.ready`;
  }
}

export interface IState {
  interactive: IInteractiveClient;
  state: ConnectionState;
  serverOffset: number;
  initialised: boolean;
  currentScript?: string;
  error?: string;
  initialise: () => Promise<void>;
  uploadScript: (funscriptPath: string) => Promise<void>;
  sync: () => Promise<void>;
}

export const InteractiveContext = React.createContext<IState>({
  interactive: new InteractiveAPI("", 0),
  state: ConnectionState.Missing,
  serverOffset: 0,
  initialised: false,
  initialise: () => {
    return Promise.resolve();
  },
  uploadScript: () => {
    return Promise.resolve();
  },
  sync: () => {
    return Promise.resolve();
  },
});

const LOCAL_FORAGE_KEY = "interactive";
const TIME_BETWEEN_SYNCS = 60 * 60 * 1000; // 1 hour

interface IInteractiveState {
  serverOffset: number;
  lastSyncTime: number;
}

export const defaultInteractiveClientProvider: IInteractiveClientProvider = ({
  handyKey,
  scriptOffset,
}): IInteractiveClient => {
  return new InteractiveAPI(handyKey, scriptOffset);
};

export const InteractiveProvider: React.FC = ({ children }) => {
  const [{ data: config }, setConfig] = useLocalForage<IInteractiveState>(
    LOCAL_FORAGE_KEY,
    { serverOffset: 0, lastSyncTime: 0 }
  );

  const { configuration: stashConfig } = useConfigurationContext();

  // "cloud" = handyfeeling.com API (default); "local" = stash backend BLE
  // bridge (/handy/ws), no cloud round-trip. Read from the server-side UI
  // config (shared across every browser/device, incl. the Quest) rather than
  // per-browser localForage — the BLE link it selects is a server-side
  // singleton, so an incognito window or a headset that never touched the
  // desktop's storage still resolves the local client.
  const handyConnectionMode: string =
    (stashConfig?.ui as IUIConfig | undefined)?.handyConnectionMode ?? "cloud";

  const [state, setState] = useState<ConnectionState>(ConnectionState.Missing);
  const [handyKey, setHandyKey] = useState<string | undefined>(undefined);
  const [currentScript, setCurrentScript] = useState<string | undefined>(
    undefined
  );
  const [scriptOffset, setScriptOffset] = useState<number>(0);
  const [useStashHostedFunscript, setUseStashHostedFunscript] =
    useState<boolean>(false);
  const [handyAppKey, setHandyAppKey] = useState<string | undefined>(undefined);

  const resolveInteractiveClient = useCallback(() => {
    // a plugin-registered provider always wins
    if (InteractiveUtils.interactiveClientProvider) {
      return InteractiveUtils.interactiveClientProvider({
        handyKey: "",
        scriptOffset: 0,
        defaultClientProvider: defaultInteractiveClientProvider,
        stashConfig,
      });
    }
    if (handyConnectionMode === "local") {
      return new LocalHandyInteractive(0);
    }
    return defaultInteractiveClientProvider({
      handyKey: "",
      scriptOffset: 0,
      defaultClientProvider: defaultInteractiveClientProvider,
      stashConfig,
    });
  }, [stashConfig, handyConnectionMode]);

  // fetch client provider from PluginApi if not found use default provider
  const [interactive, setInteractive] = useState(resolveInteractiveClient);

  const [initialised, setInitialised] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // switching connection mode swaps the client implementation
  useEffect(() => {
    const isLocal = interactive instanceof LocalHandyInteractive;
    const wantLocal = handyConnectionMode === "local";
    if (isLocal !== wantLocal && !InteractiveUtils.interactiveClientProvider) {
      setInitialised(false);
      setState(ConnectionState.Missing);
      setInteractive(resolveInteractiveClient());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handyConnectionMode]);

  // Local (Bluetooth) mode has no cloud handyKey to trigger the auto-connect
  // effect below, so a browser that didn't run the scan itself (e.g. the Quest,
  // a separate session from the desktop where the user connected in Settings)
  // would show the device as disconnected even though the server-side BLE link
  // is live. Attach to that existing session on mount — reflect its status
  // without kicking off a fresh 30s scan. If nothing is connected yet, stay
  // idle and let the user connect explicitly.
  useEffect(() => {
    if (handyConnectionMode !== "local") return;
    if (!(interactive instanceof LocalHandyInteractive)) return;
    if (initialised) return;
    let cancelled = false;
    interactive
      .attach()
      .then((connected) => {
        if (cancelled || !connected) return;
        setState(ConnectionState.Ready);
        setInitialised(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [handyConnectionMode, interactive, initialised]);

  const initialise = useCallback(async () => {
    setError(undefined);

    const shouldResync =
      !config?.lastSyncTime ||
      Date.now() - config?.lastSyncTime > TIME_BETWEEN_SYNCS;

    let serverOffset = config?.serverOffset ?? 0;

    if (!config?.serverOffset || shouldResync) {
      setState(ConnectionState.Syncing);
      const offset = await interactive.sync();
      setConfig({ serverOffset: offset, lastSyncTime: Date.now() });
      serverOffset = offset;
    }

    if (serverOffset) {
      await interactive.configure({
        estimatedServerTimeOffset: serverOffset,
      });
      setState(ConnectionState.Connecting);
      try {
        await interactive.connect();
        setState(ConnectionState.Ready);
        setInitialised(true);
      } catch (e) {
        if (e instanceof Error) {
          setError(e.message ?? e.toString());
          setState(ConnectionState.Error);
        }
      }
    }
  }, [config, interactive, setConfig]);

  useEffect(() => {
    if (!stashConfig) {
      return;
    }

    setHandyKey(stashConfig.interface.handyKey ?? undefined);
    setScriptOffset(stashConfig.interface.funscriptOffset ?? 0);
    setUseStashHostedFunscript(
      stashConfig.interface.useStashHostedFunscript ?? false
    );
    setHandyAppKey(stashConfig.interface.handyAppKey ?? undefined);
  }, [stashConfig]);

  useEffect(() => {
    if (!config) {
      return;
    }

    const oldKey = interactive.handyKey;

    interactive
      .configure({
        connectionKey: handyKey ?? "",
        scriptOffset,
        useStashHostedFunscript,
        appKey: handyAppKey ?? "",
      })
      .then(() => {
        if (oldKey !== interactive.handyKey && interactive.handyKey) {
          initialise();
        }
      });
  }, [
    handyKey,
    handyAppKey,
    scriptOffset,
    useStashHostedFunscript,
    config,
    interactive,
    initialise,
  ]);

  const sync = useCallback(async () => {
    if (
      !interactive.handyKey ||
      state === ConnectionState.Syncing ||
      !initialised
    ) {
      return;
    }

    setState(ConnectionState.Syncing);
    const offset = await interactive.sync();
    setConfig({ serverOffset: offset, lastSyncTime: Date.now() });
    setState(ConnectionState.Ready);
  }, [interactive, state, setConfig, initialised]);

  const uploadScript = useCallback(
    async (funscriptPath: string) => {
      await interactive.pause();
      if (
        !interactive.handyKey ||
        !funscriptPath ||
        funscriptPath === currentScript
      ) {
        return Promise.resolve();
      }

      setState(ConnectionState.Uploading);
      try {
        await interactive.uploadScript(
          funscriptPath,
          stashConfig?.general?.apiKey
        );
        setCurrentScript(funscriptPath);
        setState(ConnectionState.Ready);
      } catch (e) {
        setState(ConnectionState.Error);
      }
    },
    [interactive, currentScript, stashConfig]
  );

  return (
    <InteractiveContext.Provider
      value={{
        interactive,
        state,
        error,
        currentScript,
        serverOffset: config?.serverOffset ?? 0,
        initialised,
        initialise,
        uploadScript,
        sync,
      }}
    >
      {children}
    </InteractiveContext.Provider>
  );
};

export const useInteractive = () => {
  return useContext(InteractiveContext);
};
export default InteractiveProvider;
