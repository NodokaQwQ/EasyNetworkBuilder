import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetch1hProbeTicks,
  fetchMeInfo,
  fetchPublicSettings,
  rpcClient,
  type LiveNodeStatus,
  type MeInfo,
  type ProbeTick,
  type PublicSettings,
  type ThemeNode,
} from "@/lib/rpc";

export interface GlobalTrafficPoint {
  ts: number;
  label: string;
  up: number;
  down: number;
}

interface DataContextValue {
  loading: boolean;
  wsConnected: boolean;
  publicSettings: PublicSettings;
  me: MeInfo;
  nodes: ThemeNode[];
  statuses: Record<string, LiveNodeStatus>;
  probeTicks: Record<string, Record<string, ProbeTick[]>>;
  trafficHistory: GlobalTrafficPoint[];
  refreshNow: () => Promise<void>;
}

const DataContext = createContext<DataContextValue>({
  loading: true,
  wsConnected: false,
  publicSettings: {},
  me: { logged_in: false },
  nodes: [],
  statuses: {},
  probeTicks: {},
  trafficHistory: [],
  refreshNow: async () => undefined,
});

const MAX_TRAFFIC_POINTS = 30; // ~1 minute at 2s intervals

function buildInitialTrafficWindow(up = 0, down = 0): GlobalTrafficPoint[] {
  const now = Date.now();
  const pts: GlobalTrafficPoint[] = [];
  for (let i = 14; i >= 0; i--) {
    const ts = now - i * 2000;
    const d = new Date(ts);
    pts.push({
      ts,
      label: d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
      up: i === 0 ? up : 0,
      down: i === 0 ? down : 0,
    });
  }
  return pts;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(rpcClient.connected);
  const [publicSettings, setPublicSettings] = useState<PublicSettings>({});
  const [me, setMe] = useState<MeInfo>({ logged_in: false });
  const [nodesMap, setNodesMap] = useState<Record<string, ThemeNode>>({});
  const [statuses, setStatuses] = useState<Record<string, LiveNodeStatus>>({});
  const [probeTicks, setProbeTicks] = useState<
    Record<string, Record<string, ProbeTick[]>>
  >({});
  const [trafficHistory, setTrafficHistory] = useState<GlobalTrafficPoint[]>([]);

  const nodesLoadedAtRef = useRef<number>(0);
  const ticksLoadedAtRef = useRef<number>(0);
  const inflightRef = useRef<boolean>(false);

  useEffect(() => rpcClient.onStatusChange(setWsConnected), []);

  useEffect(() => {
    void Promise.all([fetchPublicSettings(), fetchMeInfo()]).then(
      ([settings, meData]) => {
        setPublicSettings(settings ?? {});
        setMe(meData ?? { logged_in: false });
      },
    );
  }, []);

  const pollStatus = useCallback(async (forceNodes = false) => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const now = Date.now();
      const shouldReloadNodes =
        forceNodes || now - nodesLoadedAtRef.current > 30_000;

      const [nextNodes, nextStatuses] = await Promise.all([
        shouldReloadNodes
          ? rpcClient
              .call<Record<string, ThemeNode>>("common:getNodes")
              .then((res) => {
                if (res && typeof res === "object") {
                  nodesLoadedAtRef.current = Date.now();
                  setNodesMap(res);
                  return res;
                }
                return null;
              })
          : Promise.resolve(null),
        rpcClient.call<Record<string, LiveNodeStatus>>(
          "common:getNodesLatestStatus",
        ),
      ]);

      if (nextStatuses && typeof nextStatuses === "object") {
        setStatuses(nextStatuses);

        let totalUp = 0;
        let totalDown = 0;
        for (const st of Object.values(nextStatuses)) {
          if (st?.online) {
            totalUp += Math.max(0, Number(st.net_out) || 0);
            totalDown += Math.max(0, Number(st.net_in) || 0);
          }
        }
        const stamp = new Date();
        const point: GlobalTrafficPoint = {
          ts: stamp.getTime(),
          label: stamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }),
          up: totalUp,
          down: totalDown,
        };
        setTrafficHistory((prev) =>
          prev.length === 0
            ? buildInitialTrafficWindow(totalUp, totalDown)
            : [...prev.slice(-(MAX_TRAFFIC_POINTS - 1)), point],
        );
      }

      const activeNodesMap = nextNodes ?? nodesMap;
      const uuids = Object.keys(activeNodesMap);
      if (uuids.length > 0 && Date.now() - ticksLoadedAtRef.current > 45_000) {
        ticksLoadedAtRef.current = Date.now();
        void fetch1hProbeTicks(uuids).then((ticks) => {
          if (Object.keys(ticks).length > 0) {
            setProbeTicks(ticks);
          }
        });
      }
    } catch {
      // transient network/auth error (e.g. private_site); keep last state
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  }, [nodesMap]);

  useEffect(() => {
    void pollStatus(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void pollStatus(false);
      }
    }, 2000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void pollStatus(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollStatus]);

  const nodes = useMemo(() => {
    return Object.entries(nodesMap)
      .map(([key, item]) => ({ ...item, uuid: item.uuid || key }))
      .sort((a, b) => {
        const wa = Number(a.weight) || 0;
        const wb = Number(b.weight) || 0;
        if (wa !== wb) return wa - wb;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [nodesMap]);

  const refreshNow = useCallback(async () => {
    const [settings, meData] = await Promise.all([
      fetchPublicSettings(),
      fetchMeInfo(),
    ]);
    setPublicSettings(settings ?? {});
    setMe(meData ?? { logged_in: false });
    await pollStatus(true);
  }, [pollStatus]);

  const value = useMemo<DataContextValue>(
    () => ({
      loading,
      wsConnected,
      publicSettings,
      me,
      nodes,
      statuses,
      probeTicks,
      trafficHistory,
      refreshNow,
    }),
    [
      loading,
      wsConnected,
      publicSettings,
      me,
      nodes,
      statuses,
      probeTicks,
      trafficHistory,
      refreshNow,
    ],
  );

  return React.createElement(DataContext.Provider, { value }, children);
}

export function useDashboardData() {
  return useContext(DataContext);
}
