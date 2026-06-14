"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Search, Trophy, Medal, EyeOff, X, Award } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { calculateUserPoints, calculateTournamentBonuses, calculateMatchPoints, getDetailedMatchScoring } from "@/scoringEngine";
import {
  ALL_GROUP_MATCHES,
  ALL_KNOCKOUT_MATCHES,
  MATCH_SCHEDULES,
  TEAMS,
  ROUND_NAMES,
  getGroupResults,
  resolveKnockoutBracket
} from "@/lib/worldCupData";
import Flag from "@/components/ui/Flag";

interface UserRankData {
  id: string;
  username: string;
  aliasName?: string;
  points: number;
  exactScores: number;
  matchPoints: number;
  bonusPoints: number;
  groupPoints: number;
  podioPoints: number;
  predictions: Record<string, any>;
  knockoutPredictions: Record<string, any>;
}

export default function LeaderboardPage() {
  const [users, setUsers] = useState<UserRankData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserRankData | null>(null);
  const [officialMatchesMap, setOfficialMatchesMap] = useState<Record<string, { home_goals: number; away_goals: number }>>({});
  const [prevRankMap, setPrevRankMap] = useState<Record<string, number>>({});

  // Control de visibilidad global
  const [quinielasVisible, setQuinielasVisible] = useState<boolean>(true);
  const [currentUsername, setCurrentUsername] = useState<string>("");
  const [hasQuiniela, setHasQuiniela] = useState<boolean>(false);
  const [quinielaStatus, setQuinielaStatus] = useState<string | null>(null);

  // Obtener tendencia comparando el ranking actual con el previo
  const getTrend = (userId: string) => {
    const current = getRank(userId);
    const previous = prevRankMap[userId];
    
    if (previous === undefined || current === 0) {
      return { type: "stable" };
    }
    
    if (current < previous) {
      // Subió en el ranking (número menor es mejor, ej: de 5 a 3)
      return { type: "up", diff: previous - current };
    } else if (current > previous) {
      // Bajó en el ranking (número mayor es peor, ej: de 3 a 5)
      return { type: "down", diff: current - previous };
    } else {
      return { type: "stable" };
    }
  };

  useEffect(() => {
    async function init() {
      try {
        // 1. Obtener la sesión del usuario actual
        const { data: { session } } = await supabase.auth.getSession();
        const username = session?.user?.user_metadata?.username || "";
        setCurrentUsername(username);
        if (session?.user) {
          setCurrentUserId(session.user.id);
        }

        // Verificar si este usuario ya tiene una quiniela registrada (pendiente o aprobada)
        if (session?.user) {
          const { data: userQ } = await supabase
            .from("user_quinielas")
            .select("id, status, predictions, knockout_predictions")
            .eq("user_id", session.user.id)
            .maybeSingle();
            
          if (userQ) {
            // Verificar si la quiniela realmente está completa
            const predsMap = userQ.predictions || {};
            const koMap = userQ.knockout_predictions || {};
            
            let isComplete = true;
            for (const m of ALL_GROUP_MATCHES) {
              const p = predsMap[m.id];
              if (!p || p.homeGoals === null || p.awayGoals === null) {
                isComplete = false;
                break;
              }
            }
            if (isComplete) {
              for (const m of ALL_KNOCKOUT_MATCHES) {
                const p = koMap[m.id];
                if (!p || p.homeGoals === null || p.awayGoals === null) {
                  isComplete = false;
                  break;
                }
              }
            }
            
            const effectiveStatus = (userQ.status === "draft" || !isComplete) ? "draft" : userQ.status;
            setHasQuiniela(effectiveStatus !== "draft");
            setQuinielaStatus(effectiveStatus);
          } else {
            setHasQuiniela(false);
            setQuinielaStatus(null);
          }
        }

        // Cargar visibilidad global del torneo
        try {
          const { data: settingData, error: settingError } = await supabase
            .from("system_settings")
            .select("value")
            .eq("key", "quinielas_visible")
            .single();
          if (!settingError && settingData && settingData.value) {
            setQuinielasVisible(!!settingData.value.enabled);
          }
        } catch (err) {
          console.warn("No se pudo obtener el ajuste de visibilidad. Por defecto: visible.");
        }

        // 2. Obtener todas las quinielas y perfiles
        const { data: quinielasData, error: quinielasError } = await supabase
          .from("user_quinielas")
          .select(`
            user_id,
            predictions,
            knockout_predictions,
            alias_name,
            profiles (username, total_points)
          `)
          .eq("status", "approved");

        if (quinielasError) throw quinielasError;

        // 3. Obtener los resultados oficiales guardados
        const { data: officialMatchesData } = await supabase
          .from("official_matches")
          .select("*");

        const officialMatches = officialMatchesData || [];
        const offMap: Record<string, { home_goals: number; away_goals: number }> = {};
        officialMatches.forEach((om: any) => {
          offMap[om.match_id] = { home_goals: om.home_goals, away_goals: om.away_goals };
        });
        setOfficialMatchesMap(offMap);

        // 4. Calcular puntos y cantidad de marcadores exactos en tiempo real usando el motor unificado
        const calculated: UserRankData[] = (quinielasData || []).map((row: any) => {
          const scoring = calculateUserPoints(
            row.predictions || {},
            row.knockout_predictions || {},
            officialMatches
          );
          const bonuses = calculateTournamentBonuses(
            row.predictions || {},
            row.knockout_predictions || {},
            officialMatches
          );

          return {
            id: row.user_id,
            username: row.profiles?.username || "Usuario",
            aliasName: row.alias_name || "",
            points: scoring.totalPoints,
            exactScores: scoring.exactScoresCount,
            matchPoints: scoring.matchPoints,
            bonusPoints: scoring.bonusPoints,
            groupPoints: bonuses.groupPoints,
            podioPoints: bonuses.podioPoints,
            predictions: row.predictions || {},
            knockoutPredictions: row.knockout_predictions || {},
          };
        });

        // 5. Ordenar por puntos desc, luego por aciertos exactos desc, y luego alfabético
        calculated.sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.exactScores !== a.exactScores) return b.exactScores - a.exactScores;
          return a.username.localeCompare(b.username);
        });

        setUsers(calculated);

        // 6. Calcular ranking previo excluyendo el último partido finalizado
        const finishedMatches = officialMatches.filter((om: any) => om.home_goals !== null && om.away_goals !== null);
        if (finishedMatches.length > 0) {
          // Ordenar los partidos finalizados cronológicamente según MATCH_SCHEDULES
          const sortedFinishedMatches = [...finishedMatches].sort((a: any, b: any) => {
            const schedA = MATCH_SCHEDULES[a.match_id];
            const schedB = MATCH_SCHEDULES[b.match_id];
            if (!schedA || !schedB) return 0;
            const dateTimeA = `${schedA.date}T${schedA.time}`;
            const dateTimeB = `${schedB.date}T${schedB.time}`;
            if (dateTimeA !== dateTimeB) {
              return dateTimeA.localeCompare(dateTimeB);
            }
            return a.match_id.localeCompare(b.match_id);
          });

          const lastMatchId = sortedFinishedMatches[sortedFinishedMatches.length - 1].match_id;
          const previousOfficialMatches = officialMatches.filter((om: any) => om.match_id !== lastMatchId);

          // Calcular puntos para todos los usuarios con este conjunto previo
          const previousCalculated = (quinielasData || []).map((row: any) => {
            const scoring = calculateUserPoints(
              row.predictions || {},
              row.knockout_predictions || {},
              previousOfficialMatches
            );
            return {
              id: row.user_id,
              username: row.profiles?.username || "Usuario",
              points: scoring.totalPoints,
              exactScores: scoring.exactScoresCount,
            };
          });

          // Ordenar previo con las mismas reglas
          previousCalculated.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.exactScores !== a.exactScores) return b.exactScores - a.exactScores;
            return a.username.localeCompare(b.username);
          });

          // Mapear user_id -> anterior posición
          const prevRanks: Record<string, number> = {};
          let currentRank = 1;
          for (let i = 0; i < previousCalculated.length; i++) {
            if (i > 0 && previousCalculated[i].points < previousCalculated[i - 1].points) {
              currentRank = i + 1;
            }
            prevRanks[previousCalculated[i].id] = currentRank;
          }
          setPrevRankMap(prevRanks);
        } else {
          setPrevRankMap({});
        }
      } catch (err) {
        console.error("Error cargando el ranking:", err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // Filtrar usuarios según la búsqueda
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    return users.filter((u) =>
      u.username.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [users, searchQuery]);

  // Dense ranking: users with same points share the same rank
  const getRank = useMemo(() => {
    const rankMap = new Map<string, number>();
    let currentRank = 1;
    for (let i = 0; i < users.length; i++) {
      if (i > 0 && users[i].points < users[i - 1].points) {
        currentRank = i + 1;
      }
      rankMap.set(users[i].id, currentRank);
    }
    return (userId: string) => rankMap.get(userId) ?? 0;
  }, [users]);

  const handleOpenPodiumUser = (rankIndex: number) => {
    const index = rankIndex - 1;
    const user = users[index];
    if (user && user.id) {
      setSelectedUser(user);
    }
  };

  const officialResolved = useMemo(() => {
    const officialGroupPreds: Record<string, any> = {};
    const officialKOPreds: Record<string, any> = {};
    Object.entries(officialMatchesMap).forEach(([id, om]) => {
      if (id.startsWith("M")) {
        officialKOPreds[id] = { matchId: id, homeGoals: om.home_goals, awayGoals: om.away_goals };
      } else {
        officialGroupPreds[id] = { matchId: id, homeGoals: om.home_goals, awayGoals: om.away_goals };
      }
    });
    const officialGroupResults = getGroupResults(officialGroupPreds);
    return resolveKnockoutBracket(officialGroupResults, officialKOPreds);
  }, [officialMatchesMap]);

  const allMatchesSorted = useMemo(() => {
    const all = [...ALL_GROUP_MATCHES, ...ALL_KNOCKOUT_MATCHES];
    return all.sort((a, b) => {
      const schedA = MATCH_SCHEDULES[a.id];
      const schedB = MATCH_SCHEDULES[b.id];
      if (!schedA || !schedB) return 0;
      const dateTimeA = `${schedA.date}T${schedA.time}`;
      const dateTimeB = `${schedB.date}T${schedB.time}`;
      return dateTimeA.localeCompare(dateTimeB);
    });
  }, []);

  const next5UpcomingMatches = useMemo(() => {
    const upcoming = allMatchesSorted.filter(m => officialMatchesMap[m.id] === undefined);
    return upcoming.slice(0, 5); // los 5 primeros próximos
  }, [allMatchesSorted, officialMatchesMap]);

  const last10PlayedMatches = useMemo(() => {
    const played = allMatchesSorted.filter(m => officialMatchesMap[m.id] !== undefined);
    return played.slice(-10).reverse(); // latest first
  }, [allMatchesSorted, officialMatchesMap]);

  const getMatchTeams = (match: any) => {
    const isKO = match.id.startsWith("M");
    if (!isKO) {
      return {
        homeTeam: TEAMS[match.homeTeam],
        awayTeam: TEAMS[match.awayTeam],
      };
    }
    const homeCode = officialResolved?.[match.id]?.home || "";
    const awayCode = officialResolved?.[match.id]?.away || "";

    return {
      homeTeam: homeCode ? TEAMS[homeCode] : null,
      awayTeam: awayCode ? TEAMS[awayCode] : null,
      homeSlot: match.homeSlot,
      awaySlot: match.awaySlot
    };
  };

  // Construir el podio de los 3 mejores con fallbacks seguros
  const top1 = users[0] || { username: "Pendiente", points: 0, aliasName: "" };
  const top2 = users[1] || { username: "Pendiente", points: 0, aliasName: "" };
  const top3 = users[2] || { username: "Pendiente", points: 0, aliasName: "" };

  const podiumUsers = [
    { rank: 2, username: top2.username, aliasName: top2.aliasName, points: top2.points, avatar: top2.username.charAt(0).toUpperCase() },
    { rank: 1, username: top1.username, aliasName: top1.aliasName, points: top1.points, avatar: top1.username.charAt(0).toUpperCase() },
    { rank: 3, username: top3.username, aliasName: top3.aliasName, points: top3.points, avatar: top3.username.charAt(0).toUpperCase() },
  ];

  // Si está oculto y no es el administrador, mostramos pantalla premium de espera para el ranking
  if (!isLoading && !quinielasVisible && currentUsername.toLowerCase() !== "vicdaddy") {
    return (
      <div className="max-w-xl mx-auto py-24 px-4 text-center animate-in zoom-in-95 duration-500">
        <div className="w-24 h-24 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-yellow-500/30 animate-pulse">
          <Trophy size={44} className="text-yellow-500 animate-bounce" />
        </div>
        <h1 className="text-3xl font-extrabold text-content mb-4 tracking-tight">Ranking Cerrado</h1>
        <p className="text-content-muted mb-4 text-lg">
          El ranking global de la SuperQuiniela se encuentra <strong className="text-yellow-500">cerrado temporalmente</strong>.
        </p>
        <p className="text-content-muted mb-8 text-base leading-relaxed">
          Las puntuaciones en tiempo real y la tabla de posiciones se activarán públicamente una vez que comience el torneo y el administrador habilite la visibilidad general.{" "}
          {quinielaStatus === "draft" ? (
            <span className="font-semibold text-yellow-500">¡Tienes un borrador guardado! Puedes continuar completándolo.</span>
          ) : hasQuiniela ? (
            <span className="font-semibold text-brand">¡Tu quiniela ya está registrada de forma segura!</span>
          ) : (
            <span className="font-semibold text-yellow-500">¡Aún no has inscrito tu quiniela!</span>
          )}
        </p>
        <a
          href="/inscribir"
          className="inline-block px-8 py-3.5 bg-brand hover:bg-brand-hover text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(0,176,107,0.3)]"
        >
          {quinielaStatus === "draft" ? "Completar Borrador" : hasQuiniela ? "Ver Mi Inscripción" : "Inscribir Quiniela"}
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto animate-in fade-in duration-500 pb-12">
      
      {/* Header & Search */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-10 md:mb-16">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-content tracking-tight">Ranking Global</h1>
          <p className="text-content-muted mt-2 text-base md:text-lg">Compite con todos los participantes de la liga y lidera el podio.</p>
        </div>
        
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
          <input 
            type="text" 
            placeholder="Buscar amigos..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-card border border-line rounded-full pl-10 pr-4 py-2.5 text-sm focus:border-brand outline-none transition-colors text-content placeholder-content-muted"
          />
        </div>
      </div>

      {/* Onboarding Prompts */}
      {currentUsername && quinielaStatus === null && (
        <div className="mb-10 bg-brand/10 border border-brand/30 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_0_20px_rgba(0,176,107,0.05)]">
          <div>
            <h3 className="font-bold text-content text-lg">¡Registra tu quiniela!</h3>
            <p className="text-sm text-content-muted mt-1">
              Aún no has inscrito tus pronósticos para el Mundial. ¡No te quedes fuera!
            </p>
          </div>
          <Link
            href="/inscribir"
            className="btn-primary py-2.5 px-5 text-sm font-bold shadow-[0_0_12px_rgba(0,176,107,0.2)] whitespace-nowrap text-center shrink-0"
          >
            Registra tu quiniela
          </Link>
        </div>
      )}

      {currentUsername && quinielaStatus === "draft" && (
        <div className="mb-10 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_0_20px_rgba(234,179,8,0.05)]">
          <div>
            <h3 className="font-bold text-content text-lg">¡Completa tu quiniela!</h3>
            <p className="text-sm text-content-muted mt-1">
              Tienes un borrador guardado a medias. Completa tu quiniela para participar.
            </p>
          </div>
          <Link
            href="/inscribir"
            className="inline-block bg-yellow-500 hover:bg-yellow-600 text-base-dark py-2.5 px-5 rounded-lg text-sm font-bold whitespace-nowrap text-center shrink-0 transition-colors shadow-[0_0_12px_rgba(234,179,8,0.2)]"
          >
            Completa tu quiniela
          </Link>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-24">
          <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-content-muted font-medium">Calculando puntuaciones globales...</p>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-24 glass-panel p-8">
          <Trophy size={48} className="text-brand/40 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-content">No hay quinielas inscritas</h3>
          <p className="text-content-muted mt-2">Nadie ha participado todavía. ¡Sé el primero en inscribirte!</p>
        </div>
      ) : (
        <>
          {/* Podium Section */}
          <div className="flex items-end justify-center gap-1.5 sm:gap-4 md:gap-8 mb-6 sm:mb-10 md:mb-16 h-44 sm:h-60 md:h-64 px-1 sm:px-2">
            
            {/* Second Place */}
            <div 
              onClick={() => handleOpenPodiumUser(2)}
              className="flex flex-col items-center relative z-10 translate-y-4 sm:translate-y-8 flex-1 max-w-[105px] sm:max-w-[140px] md:max-w-[160px] cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200"
            >
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-gray-400 flex items-center justify-center absolute -top-2.5 sm:-top-4 z-20 shadow-md">
                <Medal size={12} className="text-white sm:hidden" />
                <Medal size={14} className="text-white hidden sm:block" />
              </div>
              <div className="glass-panel p-2.5 sm:p-5 md:p-6 flex flex-col items-center w-full border-t-3 sm:border-t-4 border-gray-400 bg-gradient-to-b from-gray-400/10 to-transparent">
                <div className="w-9 h-9 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-full bg-gray-500 flex items-center justify-center text-sm sm:text-lg md:text-xl font-bold text-white mb-1.5 sm:mb-3">{podiumUsers[0].avatar}</div>
                <p style={{ color: '#ffffff' }} className="font-semibold text-[11px] sm:text-sm mb-0.5 truncate max-w-full text-center">{podiumUsers[0].username}</p>
                {currentUsername.toLowerCase() === "vicdaddy" && podiumUsers[0].aliasName && (
                  <p className="text-[9px] text-yellow-500 font-bold mb-0.5 truncate max-w-full text-center">Apodo: {podiumUsers[0].aliasName}</p>
                )}
                <p style={{ color: '#d1d5db' }} className="text-sm sm:text-lg md:text-xl font-bold">{podiumUsers[0].points} <span className="text-[9px] sm:text-xs">PTS</span></p>
              </div>
            </div>

            {/* First Place */}
            <div 
              onClick={() => handleOpenPodiumUser(1)}
              className="flex flex-col items-center relative z-20 -translate-y-1 sm:-translate-y-4 flex-1 max-w-[115px] sm:max-w-[160px] md:max-w-[192px] cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200"
            >
              <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-yellow-500 flex items-center justify-center absolute -top-3 sm:-top-5 z-20 shadow-[0_0_15px_rgba(234,179,8,0.5)]">
                <Trophy size={14} className="text-white sm:hidden" />
                <Trophy size={20} className="text-white hidden sm:block" />
              </div>
              <div className="glass-panel p-3 sm:p-6 md:p-8 flex flex-col items-center w-full border-t-3 sm:border-t-4 border-yellow-500 bg-gradient-to-b from-yellow-500/10 to-transparent shadow-[0_0_30px_rgba(234,179,8,0.15)] relative overflow-hidden podium-glow-first">
                {/* Floating sparkles */}
                <span className="sparkle-particle animate-sparkle-1 w-1.5 h-1.5 bg-yellow-500/70 left-[15%] bottom-[10%]"></span>
                <span className="sparkle-particle animate-sparkle-2 w-1 h-1 bg-yellow-400/80 left-[80%] bottom-[20%]"></span>
                <span className="sparkle-particle animate-sparkle-3 w-2 h-2 bg-yellow-600/60 left-[45%] bottom-[5%]"></span>
                <span className="sparkle-particle animate-sparkle-4 w-1.5 h-1.5 bg-amber-400/70 left-[70%] bottom-[40%]"></span>
                
                <div className="w-11 h-11 sm:w-18 sm:h-18 md:w-20 md:h-20 rounded-full border-2 border-yellow-500 bg-yellow-600 flex items-center justify-center text-lg sm:text-2xl md:text-3xl font-bold mb-1.5 sm:mb-4 shadow-[0_0_20px_rgba(234,179,8,0.3)]">{podiumUsers[1].avatar}</div>
                <p style={{ color: '#ffffff' }} className="font-bold text-xs sm:text-base mb-0.5 truncate max-w-full text-center">{podiumUsers[1].username}</p>
                {currentUsername.toLowerCase() === "vicdaddy" && podiumUsers[1].aliasName && (
                  <p className="text-[9px] text-yellow-500 font-bold mb-0.5 truncate max-w-full text-center">Apodo: {podiumUsers[1].aliasName}</p>
                )}
                <p style={{ color: '#ffffff' }} className="text-lg sm:text-2xl md:text-3xl font-black">{podiumUsers[1].points} <span style={{ color: '#a1a1aa' }} className="text-[10px] sm:text-sm font-normal">PTS</span></p>
              </div>
            </div>

            {/* Third Place */}
            <div 
              onClick={() => handleOpenPodiumUser(3)}
              className="flex flex-col items-center relative z-10 translate-y-6 sm:translate-y-10 md:translate-y-12 flex-1 max-w-[105px] sm:max-w-[140px] md:max-w-[160px] cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200"
            >
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-amber-600 flex items-center justify-center absolute -top-2.5 sm:-top-4 z-20 shadow-md">
                <Medal size={12} className="text-white sm:hidden" />
                <Medal size={14} className="text-white hidden sm:block" />
              </div>
              <div className="glass-panel p-2.5 sm:p-5 md:p-6 flex flex-col items-center w-full border-t-3 sm:border-t-4 border-amber-600 bg-gradient-to-b from-amber-600/10 to-transparent">
                <div className="w-9 h-9 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-full bg-amber-700 flex items-center justify-center text-sm sm:text-lg md:text-xl font-bold text-white mb-1.5 sm:mb-3">{podiumUsers[2].avatar}</div>
                <p style={{ color: '#ffffff' }} className="font-semibold text-[11px] sm:text-sm mb-0.5 truncate max-w-full text-center">{podiumUsers[2].username}</p>
                {currentUsername.toLowerCase() === "vicdaddy" && podiumUsers[2].aliasName && (
                  <p className="text-[9px] text-yellow-500 font-bold mb-0.5 truncate max-w-full text-center">Apodo: {podiumUsers[2].aliasName}</p>
                )}
                <p style={{ color: '#f59e0b' }} className="text-sm sm:text-lg md:text-xl font-bold">{podiumUsers[2].points} <span className="text-[9px] sm:text-xs">PTS</span></p>
              </div>
            </div>

          </div>

          {/* Leaderboard Table */}
          <div className="glass-panel overflow-hidden">
            {/* Desktop Table */}
            <table className="w-full text-left border-collapse hidden sm:table">
              <thead>
                <tr className="bg-card border-b border-line text-xs uppercase tracking-wider text-content-muted">
                  <th className="p-4 font-semibold w-16">#</th>
                  <th className="p-4 font-semibold">Usuario</th>
                  <th className="p-4 font-semibold text-center">Exactos</th>
                  <th className="p-4 font-semibold text-right">Puntos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredUsers.map((user) => {
                  const rank = getRank(user.id);
                  const isCurrentUser = user.id === currentUserId;
                  return (
                    <tr 
                      key={user.id} 
                      className={`hover:bg-card/50 transition-colors cursor-pointer ${
                        isCurrentUser ? "bg-brand/5 border-l-4 border-brand" : ""
                      }`}
                      onClick={() => setSelectedUser(user)}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-content-muted w-4">{rank}</span>
                          {(() => {
                            const trend = getTrend(user.id);
                            if (trend.type === "up") return <span className="text-[10px] font-extrabold text-emerald-500">▲{trend.diff}</span>;
                            if (trend.type === "down") return <span className="text-[10px] font-extrabold text-rose-500">▼{trend.diff}</span>;
                            return <span className="text-[10px] font-bold text-slate-600 w-3 text-center">▬</span>;
                          })()}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isCurrentUser ? "bg-brand/20 text-brand" : "bg-line text-content-muted"
                          }`}>{user.username.charAt(0).toUpperCase()}</div>
                          <div className="min-w-0">
                            <span style={{ color: isCurrentUser ? '#00b06b' : '#ffffff' }} className="font-semibold text-base truncate block">
                              {user.username} {isCurrentUser && "(Tú)"}
                            </span>
                            {currentUsername.toLowerCase() === "vicdaddy" && user.aliasName && (
                              <span className="text-[11px] text-yellow-500 font-bold block mt-0.5">Apodo: {user.aliasName}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-center text-content-muted font-medium">{user.exactScores}</td>
                      <td className="p-4 text-right font-bold text-brand whitespace-nowrap">{user.points.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile List */}
            <div className="sm:hidden divide-y divide-line/50">
              {filteredUsers.map((user) => {
                const rank = getRank(user.id);
                const isCurrentUser = user.id === currentUserId;
                const rankColor = rank === 1 ? "bg-yellow-500 text-black" : rank === 2 ? "bg-gray-400 text-white" : rank === 3 ? "bg-amber-600 text-white" : "bg-line/80 text-content-muted";
                return (
                  <div
                    key={user.id}
                    className={`flex items-center gap-2.5 px-3 py-2.5 transition-colors cursor-pointer active:bg-card/50 ${
                      isCurrentUser ? "bg-brand/5 border-l-3 border-brand" : ""
                    }`}
                    onClick={() => setSelectedUser(user)}
                  >
                    {/* Rank Badge */}
                    <div className="flex flex-col items-center gap-0.5 shrink-0 w-8">
                      <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-black ${rankColor}`}>{rank}</span>
                      {(() => {
                        const trend = getTrend(user.id);
                        if (trend.type === "up") return <span className="text-[9px] font-extrabold text-emerald-500 leading-none">▲{trend.diff}</span>;
                        if (trend.type === "down") return <span className="text-[9px] font-extrabold text-rose-500 leading-none">▼{trend.diff}</span>;
                        return <span className="text-[9px] font-bold text-slate-600 leading-none">—</span>;
                      })()}
                    </div>
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      isCurrentUser ? "bg-brand/20 text-brand" : "bg-line text-content-muted"
                    }`}>{user.username.charAt(0).toUpperCase()}</div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <span style={{ color: isCurrentUser ? '#00b06b' : '#ffffff' }} className="font-semibold text-[13px] truncate block leading-tight">
                        {user.username} {isCurrentUser && "(Tú)"}
                      </span>
                      {currentUsername.toLowerCase() === "vicdaddy" && user.aliasName && (
                        <span className="text-[10px] text-yellow-500 font-bold block">Apodo: {user.aliasName}</span>
                      )}
                      <span className="text-[11px] text-content-muted">{user.exactScores} exactos</span>
                    </div>
                    {/* Points */}
                    <div className="shrink-0 text-right">
                      <span className="text-brand font-black text-base leading-none block">{user.points}</span>
                      <span className="text-[9px] text-content-muted font-medium">PTS</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Modal: Detalle de Puntos del Usuario */}
          {selectedUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div 
                className="absolute inset-0 bg-base/90 backdrop-blur-sm transition-opacity"
                onClick={() => setSelectedUser(null)}
              ></div>
              
              <div className="relative w-full max-w-md bg-card border border-line rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-line bg-panel/50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand/20 flex items-center justify-center border border-brand/50 text-brand font-bold text-base">
                      {selectedUser.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-content text-lg leading-tight">
                        Resumen de Puntos
                      </h3>
                      <p className="text-xs text-content-muted mt-0.5">
                        {selectedUser.username} {selectedUser.aliasName ? `(${selectedUser.aliasName})` : ""}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedUser(null)}
                    className="p-1.5 rounded-lg text-content-muted hover:text-content hover:bg-panel transition-colors cursor-pointer"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Content Body */}
                <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto custom-horizontal-scrollbar">
                  {/* Total points banner */}
                  <div className="bg-brand/10 border border-brand/25 rounded-2xl p-5 text-center relative overflow-hidden">
                    <div className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-brand/5 blur-xl pointer-events-none"></div>
                    <span className="text-xs font-bold text-brand uppercase tracking-wider block">Puntos Acumulados</span>
                    <span className="text-4xl font-black text-content mt-1 block">
                      {selectedUser.points} <span className="text-lg font-normal text-content-muted">PTS</span>
                    </span>
                    <span className="text-xs text-content-muted mt-2 block font-semibold">
                      Posición actual: #{getRank(selectedUser.id)} en el ranking
                    </span>
                  </div>

                  {/* Breakdown Grid */}
                  <div className="space-y-3.5">
                    <h4 className="text-xs font-bold text-content-muted uppercase tracking-wider">Desglose de Puntuación</h4>
                    
                    {/* 1. Aciertos en Partidos */}
                    <div className="flex items-center justify-between bg-panel/40 border border-line rounded-xl p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
                          <Award size={16} />
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-content block leading-tight">Pronósticos de Partidos</span>
                          <span className="text-[10px] text-content-muted">Aciertos de marcadores (M1-M104)</span>
                        </div>
                      </div>
                      <span className="text-base font-bold text-content whitespace-nowrap">
                        {selectedUser.matchPoints} <span className="text-xs font-medium text-content-muted">PTS</span>
                      </span>
                    </div>

                    {/* 2. Puntos por Posición de Grupo */}
                    <div className="flex items-center justify-between bg-panel/40 border border-line rounded-xl p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-400 shrink-0">
                          <Trophy size={16} />
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-content block leading-tight">Clasificación de Grupos</span>
                          <span className="text-[10px] text-content-muted">+3 pts por posición exacta en tabla</span>
                        </div>
                      </div>
                      <span className="text-base font-bold text-content whitespace-nowrap">
                        {selectedUser.groupPoints} <span className="text-xs font-medium text-content-muted">PTS</span>
                      </span>
                    </div>

                    {/* 3. Puntos por Podio del Torneo */}
                    <div className="flex items-center justify-between bg-panel/40 border border-line rounded-xl p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-yellow-500/10 border border-yellow-500/25 flex items-center justify-center text-yellow-400 shrink-0">
                          <Trophy size={16} className="text-yellow-500" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-content block leading-tight">Podio Final del Mundial</span>
                          <span className="text-[10px] text-content-muted">+5 pts por acierto en podio final</span>
                        </div>
                      </div>
                      <span className="text-base font-bold text-content whitespace-nowrap">
                        {selectedUser.podioPoints} <span className="text-xs font-medium text-content-muted">PTS</span>
                      </span>
                    </div>

                    {/* 4. Marcadores Exactos Acertados */}
                    <div className="flex items-center justify-between bg-panel/40 border border-line rounded-xl p-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/25 flex items-center justify-center text-purple-400 shrink-0">
                          <Medal size={16} />
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-content block leading-tight">Marcadores Exactos</span>
                          <span className="text-[10px] text-content-muted">Aciertos exactos de goles (+5 pts)</span>
                        </div>
                      </div>
                      <span className="text-base font-bold text-purple-400 whitespace-nowrap">
                        {selectedUser.exactScores} <span className="text-xs font-semibold">exactos</span>
                      </span>
                    </div>
                  </div>

                  {/* Contenedor de Pronósticos del Jugador (Próximos 5 y Últimos 10) */}
                  <div className="space-y-6 pt-4 border-t border-line/45">
                    
                    {/* Sección 1: Próximos 5 Pronósticos */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-content-muted uppercase tracking-wider flex items-center gap-1.5">
                        <span>🔮</span> Próximos 5 Pronósticos
                      </h4>
                      {next5UpcomingMatches.length === 0 ? (
                        <p className="text-xs text-content-muted italic">No hay partidos próximos programados.</p>
                      ) : (
                        <div className="space-y-2.5">
                          {next5UpcomingMatches.map((match) => {
                            const isKO = match.id.startsWith("M");
                            const teams = getMatchTeams(match);
                            const official = officialMatchesMap[match.id];
                            const pred = isKO 
                              ? selectedUser.knockoutPredictions?.[match.id]
                              : selectedUser.predictions?.[match.id];
                            const predExists = pred && pred.homeGoals !== null && pred.awayGoals !== null;
                            const headerLabel = isKO ? (ROUND_NAMES[(match as any).round] || (match as any).round) : `Grupo ${(match as any).group}`;

                            return (
                              <div key={match.id} className="bg-panel/30 border border-line/50 rounded-xl p-3 flex flex-col gap-2">
                                <div className="flex items-center justify-between text-[10px] text-content-muted font-bold border-b border-line/30 pb-1.5">
                                  <span className="text-brand uppercase">{headerLabel} · {match.id}</span>
                                  <span className="px-2 py-0.5 rounded-full border border-line/30 text-content-muted bg-panel/20 font-medium">
                                    Por jugar
                                  </span>
                                </div>

                                <div className="grid grid-cols-7 items-center gap-1">
                                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                                    {teams.homeTeam ? (
                                      <>
                                        <Flag iso2={teams.homeTeam.iso2} name={teams.homeTeam.name} size="sm" />
                                        <span className="text-xs font-semibold text-content truncate">{teams.homeTeam.name}</span>
                                      </>
                                    ) : (
                                      <span className="text-xs text-content-muted italic">TBD</span>
                                    )}
                                  </div>
                                  <div className="col-span-3 flex items-center justify-center gap-2">
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-[8px] text-content-muted font-bold uppercase tracking-wider scale-90">Pronos.</span>
                                      <div className="bg-base border border-line px-1.5 py-0.5 rounded text-content-muted font-medium text-xs font-mono" title="Pronóstico del participante">
                                        {predExists ? `${pred.homeGoals}-${pred.awayGoals}` : "-"}
                                      </div>
                                    </div>
                                    <span className="text-[10px] font-bold text-content-muted self-end pb-1">/</span>
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-[8px] text-content-muted/70 font-bold uppercase tracking-wider scale-90">Oficial</span>
                                      <div className="bg-panel/20 border border-line/30 px-1.5 py-0.5 rounded text-content-muted/60 font-semibold text-xs animate-pulse" title="Partido pendiente de juego">
                                        vs
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-span-2 flex items-center gap-1.5 justify-end min-w-0">
                                    {teams.awayTeam ? (
                                      <>
                                        <span className="text-xs font-semibold text-content truncate">{teams.awayTeam.name}</span>
                                        <Flag iso2={teams.awayTeam.iso2} name={teams.awayTeam.name} size="sm" />
                                      </>
                                    ) : (
                                      <span className="text-xs text-content-muted italic">TBD</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Sección 2: Últimos 10 Pronósticos Jugados */}
                    <div className="space-y-3 pt-2">
                      <h4 className="text-xs font-bold text-content-muted uppercase tracking-wider flex items-center gap-1.5">
                        <span>⚽</span> Últimos 10 Pronósticos Jugados
                      </h4>
                      {last10PlayedMatches.length === 0 ? (
                        <p className="text-xs text-content-muted italic">No se han registrado resultados oficiales todavía.</p>
                      ) : (
                        <div className="space-y-2.5">
                          {last10PlayedMatches.map((match) => {
                            const isKO = match.id.startsWith("M");
                            const teams = getMatchTeams(match);
                            const official = officialMatchesMap[match.id];
                            const pred = isKO 
                              ? selectedUser.knockoutPredictions?.[match.id]
                              : selectedUser.predictions?.[match.id];
                            const predExists = pred && pred.homeGoals !== null && pred.awayGoals !== null;
                            
                            let pts = 0;
                            let scoring: any = null;
                            if (predExists && official) {
                              pts = calculateMatchPoints(pred.homeGoals!, pred.awayGoals!, official.home_goals, official.away_goals);
                              scoring = getDetailedMatchScoring(pred.homeGoals!, pred.awayGoals!, official.home_goals, official.away_goals);
                            }

                            const pointsColor = scoring
                              ? scoring.isExactScore ? "text-emerald-400 bg-emerald-500/20 border-emerald-500/40"
                              : scoring.isWinnerGuessed || scoring.isTieGuessed ? "text-green-400 bg-green-500/15 border-green-500/30"
                              : scoring.isConsolation ? "text-yellow-400 bg-yellow-500/15 border-yellow-500/30"
                              : "text-red-400 bg-red-500/15 border-red-500/30"
                              : "";

                            const pointsLabel = scoring
                              ? scoring.isExactScore ? "Exacto"
                              : scoring.isWinnerGuessed ? "Ganador"
                              : scoring.isTieGuessed ? "Empate"
                              : scoring.isConsolation ? "Cercano"
                              : "Errado"
                              : "";

                            const headerLabel = isKO ? (ROUND_NAMES[(match as any).round] || (match as any).round) : `Grupo ${(match as any).group}`;

                            return (
                              <div key={match.id} className="bg-panel/30 border border-line/50 rounded-xl p-3 flex flex-col gap-2">
                                <div className="flex items-center justify-between text-[10px] text-content-muted font-bold border-b border-line/30 pb-1.5">
                                  <span className="text-brand uppercase">{headerLabel} · {match.id}</span>
                                  {predExists ? (
                                    <span className={`px-2 py-0.5 rounded-full border ${pointsColor}`}>
                                      +{pts} pts · {pointsLabel}
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full border border-line/40 text-content-muted bg-panel/30">
                                      Sin pronóstico
                                    </span>
                                  )}
                                </div>

                                <div className="grid grid-cols-7 items-center gap-1">
                                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                                    {teams.homeTeam ? (
                                      <>
                                        <Flag iso2={teams.homeTeam.iso2} name={teams.homeTeam.name} size="sm" />
                                        <span className="text-xs font-semibold text-content truncate">{teams.homeTeam.name}</span>
                                      </>
                                    ) : (
                                      <span className="text-xs text-content-muted italic">TBD</span>
                                    )}
                                  </div>
                                  <div className="col-span-3 flex items-center justify-center gap-2">
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-[8px] text-content-muted font-bold uppercase tracking-wider scale-90">Pronos.</span>
                                      <div className="bg-base border border-line px-1.5 py-0.5 rounded text-content-muted font-medium text-xs font-mono" title="Pronóstico del participante">
                                        {predExists ? `${pred.homeGoals}-${pred.awayGoals}` : "-"}
                                      </div>
                                    </div>
                                    <span className="text-[10px] font-bold text-content-muted self-end pb-1">/</span>
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-[8px] text-brand/80 font-bold uppercase tracking-wider scale-90">Oficial</span>
                                      <div className="bg-panel border border-brand/30 px-1.5 py-0.5 rounded text-brand text-xs font-mono" title="Resultado oficial real">
                                        {official.home_goals}-{official.away_goals}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-span-2 flex items-center gap-1.5 justify-end min-w-0">
                                    {teams.awayTeam ? (
                                      <>
                                        <span className="text-xs font-semibold text-content truncate">{teams.awayTeam.name}</span>
                                        <Flag iso2={teams.awayTeam.iso2} name={teams.awayTeam.name} size="sm" />
                                      </>
                                    ) : (
                                      <span className="text-xs text-content-muted italic">TBD</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-panel/30 border-t border-line text-center">
                  <button
                    onClick={() => setSelectedUser(null)}
                    className="w-full btn-primary py-2.5 font-bold shadow-md cursor-pointer"
                  >
                    Cerrar Resumen
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
