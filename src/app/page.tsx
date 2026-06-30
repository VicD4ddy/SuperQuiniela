"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { Users, Swords, X, Trophy, EyeOff, Search, Calendar, ChevronLeft, ChevronRight, BarChart3 } from "lucide-react";
import {
  ALL_GROUP_MATCHES,
  ALL_KNOCKOUT_MATCHES,
  getGroupResults,
  resolveKnockoutBracket,
  TEAMS,
  MatchPrediction,
  GROUP_NAMES,
  getGroupMatches,
  calculateGroupStandings,
  MATCH_SCHEDULES,
  ROUND_NAMES,
  R32_MATCHES,
  R16_MATCHES,
  QF_MATCHES,
  SF_MATCHES,
  FINAL_MATCHES,
} from "@/lib/worldCupData";
import { calculateMatchPoints, getDetailedMatchScoring, calculateTournamentBonuses, calculateUserPoints } from "@/scoringEngine";
import KnockoutBracket from "@/components/predictions/KnockoutBracket";
import GroupStandings from "@/components/predictions/GroupStandings";
import Flag from "@/components/ui/Flag";

import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// INTERFAZ DE DATOS DE USUARIO REAL
// ---------------------------------------------------------------------------
interface UserQuinielaData {
  id: string;
  username: string;
  aliasName?: string;
  championCode: string;
  runnerUpCode: string;
  points: number;
  predictions: Record<string, MatchPrediction>;
  knockoutPredictions: Record<string, MatchPrediction>;
  status?: string;
}

const flagCache: Record<string, string> = {};

// ---------------------------------------------------------------------------
// PÁGINA PRINCIPAL: HUB DE PRONÓSTICOS
// ---------------------------------------------------------------------------
export default function PronosticosPage() {
  const [viewMode, setViewMode] = useState<"feed" | "compare">("feed");
  const [users, setUsers] = useState<UserQuinielaData[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserQuinielaData | null>(null);
  const [modalTab, setModalTab] = useState<"groups" | "knockout">("groups");
  const [modalGroupIndex, setModalGroupIndex] = useState(0);
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");
  const [compareTab, setCompareTab] = useState<"groups" | "knockout">("groups");
  const [compareGroupFilter, setCompareGroupFilter] = useState<string>("all");
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [pdfStep, setPdfStep] = useState<string>("");
  const [officialMatchesMap, setOfficialMatchesMap] = useState<Record<string, { home_goals: number; away_goals: number }>>({});
  const [feedSearchQuery, setFeedSearchQuery] = useState("");
  const [selectedMatchForStats, setSelectedMatchForStats] = useState<any | null>(null);

  // Función para obtener estadísticas agregadas de la comunidad para un partido
  const getMatchCommunityStats = useCallback((matchId: string, isKO: boolean) => {
    let localWins = 0;
    let draws = 0;
    let awayWins = 0;
    let total = 0;
    const scoreCounts: Record<string, number> = {};

    users.forEach((u) => {
      const pred = isKO ? u.knockoutPredictions?.[matchId] : u.predictions?.[matchId];
      if (pred && pred.homeGoals !== null && pred.awayGoals !== null) {
        total++;
        if (pred.homeGoals > pred.awayGoals) {
          localWins++;
        } else if (pred.homeGoals < pred.awayGoals) {
          awayWins++;
        } else {
          draws++;
        }
        const scoreKey = `${pred.homeGoals}-${pred.awayGoals}`;
        scoreCounts[scoreKey] = (scoreCounts[scoreKey] || 0) + 1;
      }
    });

    if (total === 0) {
      return {
        localPct: 0,
        drawPct: 0,
        awayPct: 0,
        consensoScore: null,
        consensoPct: 0,
        total
      };
    }

    const localPct = Math.round((localWins / total) * 100);
    const drawPct = Math.round((draws / total) * 100);
    const awayPct = Math.round((awayWins / total) * 100);

    const sortedScores = Object.entries(scoreCounts).sort((a, b) => b[1] - a[1]);
    const consensoScore = sortedScores[0]?.[0] || null;
    const consensoPct = consensoScore ? Math.round((sortedScores[0][1] / total) * 100) : 0;

    return {
      localPct,
      drawPct,
      awayPct,
      consensoScore,
      consensoPct,
      total
    };
  }, [users]);

  const [activeWidgetDate, setActiveWidgetDate] = useState<string>(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const formattedToday = `${yyyy}-${mm}-${dd}`;
    if (Object.values(MATCH_SCHEDULES).some(s => s.date === formattedToday)) {
      return formattedToday;
    }
    return "2026-06-13";
  });

  const tournamentDates = useMemo(() => {
    const dates = new Set<string>();
    Object.values(MATCH_SCHEDULES).forEach((val) => {
      dates.add(val.date);
    });
    return Array.from(dates).sort();
  }, []);

  // Preparar datos oficiales para el árbol de eliminatorias en modal
  const officialMatchesMapForBracket = useMemo(() => {
    const map: Record<string, { homeGoals: number; awayGoals: number }> = {};
    Object.entries(officialMatchesMap).forEach(([id, val]) => {
      map[id] = { homeGoals: val.home_goals, awayGoals: val.away_goals };
    });
    return map;
  }, [officialMatchesMap]);

  const officialResolved = useMemo(() => {
    const officialGroupPreds: Record<string, MatchPrediction> = {};
    const officialKOPreds: Record<string, MatchPrediction> = {};
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

  // Control de visibilidad global
  const [quinielasVisible, setQuinielasVisible] = useState<boolean>(true);
  const [currentUsername, setCurrentUsername] = useState<string>("");
  const [hasQuiniela, setHasQuiniela] = useState<boolean>(false);
  const [quinielaStatus, setQuinielaStatus] = useState<string | null>(null);

  const activeDateIndex = tournamentDates.indexOf(activeWidgetDate);
  const handlePrevDate = () => {
    if (activeDateIndex > 0) {
      setActiveWidgetDate(tournamentDates[activeDateIndex - 1]);
    }
  };
  const handleNextDate = () => {
    if (activeDateIndex < tournamentDates.length - 1) {
      setActiveWidgetDate(tournamentDates[activeDateIndex + 1]);
    }
  };

  const currentDateLabel = useMemo(() => {
    const matchId = Object.keys(MATCH_SCHEDULES).find(id => MATCH_SCHEDULES[id].date === activeWidgetDate);
    return matchId ? MATCH_SCHEDULES[matchId].label : activeWidgetDate;
  }, [activeWidgetDate]);

  const matchesOfTheDay = useMemo(() => {
    const groupMatches = ALL_GROUP_MATCHES.filter(m => MATCH_SCHEDULES[m.id]?.date === activeWidgetDate);
    const knockoutMatches = ALL_KNOCKOUT_MATCHES.filter(m => MATCH_SCHEDULES[m.id]?.date === activeWidgetDate);
    return { groupMatches, knockoutMatches };
  }, [activeWidgetDate]);

  const myQuiniela = useMemo(() => {
    return users.find(u => u.id === currentUserId);
  }, [users, currentUserId]);

  const myResolvedBracket = useMemo(() => {
    if (!myQuiniela) return null;
    const groupResults = getGroupResults(myQuiniela.predictions || {});
    return resolveKnockoutBracket(groupResults, myQuiniela.knockoutPredictions || {});
  }, [myQuiniela]);

  const getMatchTeams = (match: any) => {
    const isKO = match.id.startsWith("M");
    if (!isKO) {
      return {
        homeCode: match.homeTeam,
        awayCode: match.awayTeam,
        homeTeam: TEAMS[match.homeTeam],
        awayTeam: TEAMS[match.awayTeam],
        homeSlot: "",
        awaySlot: ""
      };
    }
    const officialHome = officialResolved?.[match.id]?.home;
    const officialAway = officialResolved?.[match.id]?.away;

    const homeCode = officialHome || "";
    const awayCode = officialAway || "";

    return {
      homeCode,
      awayCode,
      homeTeam: homeCode ? TEAMS[homeCode] : null,
      awayTeam: awayCode ? TEAMS[awayCode] : null,
      homeSlot: match.homeSlot,
      awaySlot: match.awaySlot
    };
  };

  const openUserModal = (user: UserQuinielaData) => {
    setSelectedUser(user);
    setModalTab("groups");
    setModalGroupIndex(0);
  };

  const downloadGroupPredictionsPDF = async () => {
    setIsGeneratingPDF(true);
    setPdfStep("Inicializando...");
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      // 1. Cargar todas las banderas en base64 si no están en caché
      setPdfStep("Banderas (flagcdn)...");
      const teamsList = Object.values(TEAMS);
      const flagPromises = teamsList.map(async (team) => {
        if (flagCache[team.iso2]) return;
        try {
          const url = `https://flagcdn.com/w20/${team.iso2}.png`;
          const res = await fetch(url);
          const blob = await res.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          flagCache[team.iso2] = base64;
        } catch (err) {
          console.error(`Error cargando bandera de ${team.name}:`, err);
        }
      });
      await Promise.all(flagPromises);

      // 2. Preparar la lista de usuarios obteniendo todos los registros de la BD
      setPdfStep("Compilando datos...");
      const { data: officialMatchesData } = await supabase
        .from("official_matches")
        .select("*");
      const officialMatches = officialMatchesData || [];

      const { data: allQ, error: qError } = await supabase
        .from("user_quinielas")
        .select(`
          user_id,
          predictions,
          knockout_predictions,
          alias_name,
          status,
          profiles (username)
        `);

      if (qError) throw qError;

      let pdfUsers = (allQ || []).map((row: any) => {
        const scoring = calculateUserPoints(
          row.predictions || {},
          row.knockout_predictions || {},
          officialMatches
        );
        
        return {
          id: row.user_id,
          username: row.profiles?.username || "Usuario",
          aliasName: row.alias_name || "",
          points: scoring.totalPoints,
          predictions: row.predictions || {},
          knockoutPredictions: row.knockout_predictions || {},
          championCode: "TBD",
          runnerUpCode: "TBD"
        };
      });

      // Ordenar por puntos (manteniendo a los mejores arriba)
      setPdfStep("Generando PDF...");
      pdfUsers.sort((a, b) => b.points - a.points);
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      // Ordenar partidos por grupo y jornada
      const sortedMatches = [...ALL_GROUP_MATCHES].sort((a, b) => {
        if (a.group !== b.group) {
          return a.group.localeCompare(b.group);
        }
        return a.matchday - b.matchday;
      });

      pdfUsers.forEach((user, index) => {
        if (index > 0) {
          doc.addPage();
        }

        // Encabezado principal de la página
        doc.setFillColor(15, 23, 42); // Slate-900
        doc.rect(0, 0, 210, 32, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text("Quiniela 2026 - Fase de Grupos", 14, 13);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(156, 163, 175); // Gray-400
        doc.text("Participante: ", 14, 21);
        
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 176, 107); // Brand Green
        doc.text(user.username, 37, 21);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.text(`Puntos acumulados: ${user.points} PTS`, 14, 27);

        const today = new Date().toLocaleDateString("es-MX", {
          day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
        });
        doc.setFontSize(8);
        doc.setTextColor(156, 163, 175);
        doc.text(`Generado: ${today}`, 150, 13);

        // Preparar datos de las tablas
        const leftTableData: any[] = [];
        const rightTableData: any[] = [];

        for (let i = 0; i < 36; i++) {
          const match = sortedMatches[i];
          const pred = user.predictions[match.id];
          const predStr = (pred && pred.homeGoals !== null && pred.awayGoals !== null) 
            ? `${pred.homeGoals} - ${pred.awayGoals}` 
            : "-";
          leftTableData.push([match.group, "", match.homeTeam, "vs", match.awayTeam, "", predStr]);
        }

        for (let i = 36; i < 72; i++) {
          const match = sortedMatches[i];
          const pred = user.predictions[match.id];
          const predStr = (pred && pred.homeGoals !== null && pred.awayGoals !== null) 
            ? `${pred.homeGoals} - ${pred.awayGoals}` 
            : "-";
          rightTableData.push([match.group, "", match.homeTeam, "vs", match.awayTeam, "", predStr]);
        }

        // Dibujar Tabla Izquierda
        autoTable(doc, {
          head: [["G", "", "Local", "vs", "Vis.", "", "Pronóstico"]],
          body: leftTableData,
          startY: 38,
          margin: { left: 14, right: 108 },
          styles: { 
            fontSize: 7.5, 
            cellPadding: 1.6,
            fillColor: [255, 255, 255],
            textColor: [15, 23, 42],
            lineColor: [226, 232, 240],
            lineWidth: 0.1,
          },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontSize: 7.5,
            fontStyle: "bold",
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
          columnStyles: {
            0: { cellWidth: 8, halign: "center" },
            1: { cellWidth: 8, halign: "center" }, // Espacio para Bandera Local
            2: { cellWidth: 14, halign: "right", fontStyle: "bold" },
            3: { cellWidth: 8, halign: "center", textColor: [156, 163, 175] },
            4: { cellWidth: 14, halign: "left", fontStyle: "bold" },
            5: { cellWidth: 8, halign: "center" }, // Espacio para Bandera Vis.
            6: { cellWidth: 28, halign: "center", fontStyle: "bold", textColor: [0, 176, 107] },
          },
          theme: "grid",
          didDrawCell: (data: any) => {
            if (data.section === "body") {
              const rowIndex = data.row.index;
              const match = sortedMatches[rowIndex];
              if (data.column.index === 1) {
                const base64 = flagCache[TEAMS[match.homeTeam]?.iso2];
                if (base64) {
                  const x = data.cell.x + (data.cell.width - 5.5) / 2;
                  const y = data.cell.y + (data.cell.height - 3.8) / 2;
                  doc.addImage(base64, "PNG", x, y, 5.5, 3.8);
                }
              } else if (data.column.index === 5) {
                const base64 = flagCache[TEAMS[match.awayTeam]?.iso2];
                if (base64) {
                  const x = data.cell.x + (data.cell.width - 5.5) / 2;
                  const y = data.cell.y + (data.cell.height - 3.8) / 2;
                  doc.addImage(base64, "PNG", x, y, 5.5, 3.8);
                }
              }
            }
          }
        });

        // Dibujar Tabla Derecha (en la misma posición Y de inicio)
        autoTable(doc, {
          head: [["G", "", "Local", "vs", "Vis.", "", "Pronóstico"]],
          body: rightTableData,
          startY: 38,
          margin: { left: 110, right: 14 },
          styles: { 
            fontSize: 7.5, 
            cellPadding: 1.6,
            fillColor: [255, 255, 255],
            textColor: [15, 23, 42],
            lineColor: [226, 232, 240],
            lineWidth: 0.1,
          },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontSize: 7.5,
            fontStyle: "bold",
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
          columnStyles: {
            0: { cellWidth: 8, halign: "center" },
            1: { cellWidth: 8, halign: "center" }, // Espacio para Bandera Local
            2: { cellWidth: 14, halign: "right", fontStyle: "bold" },
            3: { cellWidth: 8, halign: "center", textColor: [156, 163, 175] },
            4: { cellWidth: 14, halign: "left", fontStyle: "bold" },
            5: { cellWidth: 8, halign: "center" }, // Espacio para Bandera Vis.
            6: { cellWidth: 28, halign: "center", fontStyle: "bold", textColor: [0, 176, 107] },
          },
          theme: "grid",
          didDrawCell: (data: any) => {
            if (data.section === "body") {
              const rowIndex = data.row.index;
              const match = sortedMatches[36 + rowIndex];
              if (data.column.index === 1) {
                const base64 = flagCache[TEAMS[match.homeTeam]?.iso2];
                if (base64) {
                  const x = data.cell.x + (data.cell.width - 5.5) / 2;
                  const y = data.cell.y + (data.cell.height - 3.8) / 2;
                  doc.addImage(base64, "PNG", x, y, 5.5, 3.8);
                }
              } else if (data.column.index === 5) {
                const base64 = flagCache[TEAMS[match.awayTeam]?.iso2];
                if (base64) {
                  const x = data.cell.x + (data.cell.width - 5.5) / 2;
                  const y = data.cell.y + (data.cell.height - 3.8) / 2;
                  doc.addImage(base64, "PNG", x, y, 5.5, 3.8);
                }
              }
            }
          }
        });

        // Agregar pie de página para cada usuario
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184); // Slate-400
        doc.text(`SuperQuiniela 2026 - Pág. ${index + 1} de ${pdfUsers.length}`, 14, 287);
        doc.text("Transparencia y deportividad · Todos los pronósticos están congelados al inicio del torneo.", 75, 287);
      });

      doc.save("Quiniela_2026_Pronosticos_Grupos.pdf");
    } catch (err) {
      console.error("Error al generar PDF:", err);
      alert("Ocurrió un error al generar el PDF de pronósticos.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const downloadKnockoutPredictionsPDF = async () => {
    setIsGeneratingPDF(true);
    setPdfStep("Inicializando...");
    try {
      const { default: jsPDF } = await import("jspdf");

      // 1. Cargar todas las banderas en base64 si no están en caché
      setPdfStep("Banderas (flagcdn)...");
      const teamsList = Object.values(TEAMS);
      const flagPromises = teamsList.map(async (team) => {
        if (flagCache[team.iso2]) return;
        try {
          const url = `https://flagcdn.com/w20/${team.iso2}.png`;
          const res = await fetch(url);
          const blob = await res.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          flagCache[team.iso2] = base64;
        } catch (err) {
          console.error(`Error cargando bandera de ${team.name}:`, err);
        }
      });
      await Promise.all(flagPromises);

      // 2. Preparar la lista de usuarios incluyendo a Vicdaddy si no está en el listado de aprobados
      setPdfStep("Compilando datos...");
      // 2. Preparar la lista de usuarios obteniendo todos los registros de la BD
      setPdfStep("Compilando datos...");
      const { data: officialMatchesData } = await supabase
        .from("official_matches")
        .select("*");
      const officialMatches = officialMatchesData || [];

      const { data: allQ, error: qError } = await supabase
        .from("user_quinielas")
        .select(`
          user_id,
          predictions,
          knockout_predictions,
          alias_name,
          status,
          profiles (username)
        `);

      if (qError) throw qError;

      let pdfUsers = (allQ || []).map((row: any) => {
        const scoring = calculateUserPoints(
          row.predictions || {},
          row.knockout_predictions || {},
          officialMatches
        );
        
        return {
          id: row.user_id,
          username: row.profiles?.username || "Usuario",
          aliasName: row.alias_name || "",
          points: scoring.totalPoints,
          predictions: row.predictions || {},
          knockoutPredictions: row.knockout_predictions || {},
          championCode: "TBD",
          runnerUpCode: "TBD"
        };
      });

      // Ordenar por puntos (manteniendo a los mejores arriba)
      setPdfStep("Generando PDF...");
      pdfUsers.sort((a, b) => b.points - a.points);

      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      // Definir partidos por columnas (bracket FIFA 2026 de 32 equipos)
      const col0Matches = ["M74", "M77", "M73", "M75", "M83", "M84", "M81", "M82"];
      const col1Matches = ["M89", "M90", "M91", "M92"];
      const col2Matches = ["M97", "M98"];
      const col3Matches = ["M101"];
      // Col 4 es Final ("M104") y 3RD ("M103")
      const col5Matches = ["M102"];
      const col6Matches = ["M99", "M100"];
      const col7Matches = ["M93", "M94", "M95", "M96"];
      const col8Matches = ["M76", "M78", "M79", "M80", "M86", "M88", "M85", "M87"];

      const colX = [10, 41.375, 72.75, 104.125, 135.5, 166.875, 198.25, 229.625, 261.0];
      const boxWidth = 26;
      const boxHeight = 13;

      pdfUsers.forEach((user, index) => {
        if (index > 0) {
          doc.addPage();
        }

        // Encabezado principal de la página (Landscape banner)
        doc.setFillColor(15, 23, 42); // Slate-900
        doc.rect(0, 0, 297, 22, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text("SuperQuiniela 2026 - Fase Eliminatoria", 10, 8);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(156, 163, 175); // Gray-400
        doc.text("Participante: ", 10, 15);
        
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 176, 107); // Brand Green
        doc.text(user.username, 29, 15);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8.5);
        doc.text(`Puntos acumulados: ${user.points} PTS`, 100, 15);

        const today = new Date().toLocaleDateString("es-MX", {
          day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
        });
        doc.setFontSize(8);
        doc.setTextColor(156, 163, 175);
        doc.text(`Generado: ${today}`, 240, 8);

        // Nombres de las rondas encima de cada columna
        const roundTitles = [
          "Ronda de 32",
          "Octavos",
          "Cuartos",
          "Semifinal",
          "F/3RD",
          "Semifinal",
          "Cuartos",
          "Octavos",
          "Ronda de 32"
        ];
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139); // slate-500
        roundTitles.forEach((title, colIdx) => {
          const xCenter = colX[colIdx] + boxWidth / 2;
          doc.text(title, xCenter, 25, { align: "center" });
        });

        // Resolver el bracket dinámico para este usuario
        const userGroupResults = getGroupResults(user.predictions || {});
        const userBracket = resolveKnockoutBracket(userGroupResults, user.knockoutPredictions || {});

        // Calcular posiciones Y de cada partido dinámicamente
        const matchPositions: Record<string, { x: number; y: number }> = {};

        // Lado Izquierdo
        col0Matches.forEach((mId, i) => {
          matchPositions[mId] = { x: colX[0], y: 28 + i * 22.2 };
        });
        col1Matches.forEach((mId, i) => {
          const y0 = matchPositions[col0Matches[2*i]].y;
          const y1 = matchPositions[col0Matches[2*i+1]].y;
          matchPositions[mId] = { x: colX[1], y: (y0 + y1) / 2 };
        });
        col2Matches.forEach((mId, i) => {
          const y0 = matchPositions[col1Matches[2*i]].y;
          const y1 = matchPositions[col1Matches[2*i+1]].y;
          matchPositions[mId] = { x: colX[2], y: (y0 + y1) / 2 };
        });
        col3Matches.forEach((mId, i) => {
          const y0 = matchPositions[col2Matches[0]].y;
          const y1 = matchPositions[col2Matches[1]].y;
          matchPositions[mId] = { x: colX[3], y: (y0 + y1) / 2 };
        });

        // Lado Derecho
        col8Matches.forEach((mId, i) => {
          matchPositions[mId] = { x: colX[8], y: 28 + i * 22.2 };
        });
        col7Matches.forEach((mId, i) => {
          const y0 = matchPositions[col8Matches[2*i]].y;
          const y1 = matchPositions[col8Matches[2*i+1]].y;
          matchPositions[mId] = { x: colX[7], y: (y0 + y1) / 2 };
        });
        col6Matches.forEach((mId, i) => {
          const y0 = matchPositions[col7Matches[2*i]].y;
          const y1 = matchPositions[col7Matches[2*i+1]].y;
          matchPositions[mId] = { x: colX[6], y: (y0 + y1) / 2 };
        });
        col5Matches.forEach((mId, i) => {
          const y0 = matchPositions[col6Matches[0]].y;
          const y1 = matchPositions[col6Matches[1]].y;
          matchPositions[mId] = { x: colX[5], y: (y0 + y1) / 2 };
        });

        // Centro
        matchPositions["M104"] = { x: colX[4], y: 94.6 }; // Gran Final
        matchPositions["M103"] = { x: colX[4], y: 122.0 }; // Tercer Puesto

        // Función auxiliar para dibujar conectores gráficos
        const drawConnector = (
          fromId: string,
          toId: string,
          side: "left" | "right",
          isLowerSlot?: boolean
        ) => {
          const fromPos = matchPositions[fromId];
          const toPos = matchPositions[toId];
          if (!fromPos || !toPos) return;

          const slotTeams = userBracket[fromId] || { home: "", away: "" };
          const pred = user.knockoutPredictions[fromId];
          const homeGoals = pred?.homeGoals;
          const awayGoals = pred?.awayGoals;

          let winnerCode = "";
          if (slotTeams.home && slotTeams.away && homeGoals !== null && homeGoals !== undefined && awayGoals !== null && awayGoals !== undefined) {
            winnerCode = homeGoals >= awayGoals ? slotTeams.home : slotTeams.away;
          }

          const targetSlotTeams = userBracket[toId] || { home: "", away: "" };
          const isActive = !!winnerCode && (targetSlotTeams.home === winnerCode || targetSlotTeams.away === winnerCode);

          if (isActive) {
            doc.setDrawColor(0, 176, 107); // Verde actante
            doc.setLineWidth(0.35);
          } else {
            doc.setDrawColor(226, 232, 240); // Gris pizarra suave
            doc.setLineWidth(0.15);
          }

          const yFrom = fromPos.y + boxHeight / 2;
          const yTo = toPos.y + (isLowerSlot ? 9.75 : 3.25);

          if (side === "left") {
            const xStart = fromPos.x + boxWidth;
            const xEnd = toPos.x;
            const xMid = (xStart + xEnd) / 2;

            doc.line(xStart, yFrom, xMid, yFrom);
            doc.line(xMid, yFrom, xMid, yTo);
            doc.line(xMid, yTo, xEnd, yTo);
          } else {
            const xStart = fromPos.x;
            const xEnd = toPos.x + boxWidth;
            const xMid = (xStart + xEnd) / 2;

            doc.line(xStart, yFrom, xMid, yFrom);
            doc.line(xMid, yFrom, xMid, yTo);
            doc.line(xMid, yTo, xEnd, yTo);
          }
        };

        // Dibujar Conectores Izquierdos
        col0Matches.forEach((mId, i) => drawConnector(mId, col1Matches[Math.floor(i/2)], "left", i % 2 === 1));
        col1Matches.forEach((mId, i) => drawConnector(mId, col2Matches[Math.floor(i/2)], "left", i % 2 === 1));
        col2Matches.forEach((mId, i) => drawConnector(mId, col3Matches[0], "left", i === 1));
        drawConnector(col3Matches[0], "M104", "left", false);
        drawConnector(col3Matches[0], "M103", "left", false);

        // Dibujar Conectores Derechos
        col8Matches.forEach((mId, i) => drawConnector(mId, col7Matches[Math.floor(i/2)], "right", i % 2 === 1));
        col7Matches.forEach((mId, i) => drawConnector(mId, col6Matches[Math.floor(i/2)], "right", i % 2 === 1));
        col6Matches.forEach((mId, i) => drawConnector(mId, col5Matches[0], "right", i === 1));
        drawConnector(col5Matches[0], "M104", "right", true);
        drawConnector(col5Matches[0], "M103", "right", true);

        // Función auxiliar para dibujar cada tarjeta de partido (caja de 26x13)
        const drawMatchCard = (mId: string) => {
          const pos = matchPositions[mId];
          if (!pos) return;

          const slotTeams = userBracket[mId] || { home: "", away: "" };
          const homeCode = slotTeams.home || "";
          const awayCode = slotTeams.away || "";
          const homeTeam = homeCode ? TEAMS[homeCode] : null;
          const awayTeam = awayCode ? TEAMS[awayCode] : null;

          const pred = user.knockoutPredictions[mId];
          const homeGoals = pred?.homeGoals !== null && pred?.homeGoals !== undefined ? pred.homeGoals : null;
          const awayGoals = pred?.awayGoals !== null && pred?.awayGoals !== undefined ? pred.awayGoals : null;

          const hasBothTeams = !!homeTeam && !!awayTeam;
          const homeWins = hasBothTeams && homeGoals !== null && awayGoals !== null && homeGoals > awayGoals;
          const awayWins = hasBothTeams && homeGoals !== null && awayGoals !== null && awayGoals > homeGoals;

          // Dibujar contenedor blanco con borde gris
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(203, 213, 225); // slate-300
          doc.setLineWidth(0.15);
          doc.rect(pos.x, pos.y, boxWidth, boxHeight, "FD");

          // Dibujar indicador de ID de partido (ej. M74) arriba a la izquierda
          doc.setFont("helvetica", "bold");
          doc.setFontSize(5.5);
          doc.setTextColor(148, 163, 184); // slate-400
          doc.text(mId, pos.x + 1, pos.y - 0.7);

          // Fondo para filas ganadoras
          if (homeWins) {
            doc.setFillColor(220, 252, 231); // verde claro
            doc.rect(pos.x + 0.1, pos.y + 0.1, boxWidth - 0.2, 6.3, "F");
          }
          if (awayWins) {
            doc.setFillColor(220, 252, 231); // verde claro
            doc.rect(pos.x + 0.1, pos.y + 6.6, boxWidth - 0.2, 6.3, "F");
          }

          // Línea divisoria interna
          doc.setDrawColor(226, 232, 240); // slate-200
          doc.line(pos.x, pos.y + 6.5, pos.x + boxWidth, pos.y + 6.5);

          // Fila Local (Home)
          if (homeTeam) {
            const base64 = flagCache[homeTeam.iso2];
            if (base64) {
              doc.addImage(base64, "PNG", pos.x + 1.2, pos.y + 1.85, 4.2, 2.8);
            }
            doc.setFont("helvetica", homeWins ? "bold" : "normal");
            doc.setFontSize(7.5);
            doc.setTextColor(homeWins ? 0 : 15, homeWins ? 176 : 23, homeWins ? 107 : 42); // Verde quiniela / slate-900
            doc.text(homeTeam.code, pos.x + 6.5, pos.y + 4.55);

            // Goles
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);
            doc.setTextColor(15, 23, 42);
            doc.text(homeGoals !== null ? String(homeGoals) : "-", pos.x + boxWidth - 2, pos.y + 4.55, { align: "right" });
          } else {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(6.5);
            doc.setTextColor(148, 163, 184);
            doc.text("TBD", pos.x + 2, pos.y + 4.55);
          }

          // Fila Visitante (Away)
          if (awayTeam) {
            const base64 = flagCache[awayTeam.iso2];
            if (base64) {
              doc.addImage(base64, "PNG", pos.x + 1.2, pos.y + 8.35, 4.2, 2.8);
            }
            doc.setFont("helvetica", awayWins ? "bold" : "normal");
            doc.setFontSize(7.5);
            doc.setTextColor(awayWins ? 0 : 15, awayWins ? 176 : 23, awayWins ? 107 : 42);
            doc.text(awayTeam.code, pos.x + 6.5, pos.y + 11.05);

            // Goles
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);
            doc.setTextColor(15, 23, 42);
            doc.text(awayGoals !== null ? String(awayGoals) : "-", pos.x + boxWidth - 2, pos.y + 11.05, { align: "right" });
          } else {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(6.5);
            doc.setTextColor(148, 163, 184);
            doc.text("TBD", pos.x + 2, pos.y + 11.05);
          }
        };

        // Dibujar todos los partidos del bracket
        Object.keys(matchPositions).forEach((mId) => {
          drawMatchCard(mId);
        });

        // Calcular podio final de pronósticos
        const m103 = userBracket["M103"];
        const p103 = user.knockoutPredictions["M103"];
        let third = "TBD";
        if (m103 && p103 && p103.homeGoals !== null && p103.awayGoals !== null && m103.home && m103.away) {
          third = p103.homeGoals > p103.awayGoals ? m103.home : m103.away;
        }

        const m104 = userBracket["M104"];
        const p104 = user.knockoutPredictions["M104"];
        let champion = "TBD";
        let runnerUp = "TBD";
        if (m104 && p104 && p104.homeGoals !== null && p104.awayGoals !== null && m104.home && m104.away) {
          champion = p104.homeGoals > p104.awayGoals ? m104.home : m104.away;
          runnerUp = p104.homeGoals > p104.awayGoals ? m104.away : m104.home;
        }

        const formatTeamPodium = (code: string) => {
          if (code === "TBD") return "TBD";
          const t = TEAMS[code];
          if (!t) return "TBD";
          return t.name.length > 11 ? `${t.name.substring(0, 10)}.` : t.name;
        };

        // Dibujar caja especial de PODIO en el espacio del centro abajo
        const yPodium = 145;
        doc.setFillColor(248, 250, 252); // slate-50
        doc.setDrawColor(203, 213, 225); // slate-300
        doc.setLineWidth(0.15);
        doc.rect(colX[4], yPodium, boxWidth, 44, "FD");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(15, 23, 42); // slate-900
        doc.text("PODIO", colX[4] + boxWidth / 2, yPodium + 5, { align: "center" });
        doc.setDrawColor(226, 232, 240); // slate-200
        doc.line(colX[4], yPodium + 7, colX[4] + boxWidth, yPodium + 7);

        // 1. Campeón
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.setTextColor(71, 85, 105);
        doc.text("1. Campeón:", colX[4] + 2, yPodium + 12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(202, 138, 4); // Gold-600
        doc.text(champion !== "TBD" ? `${formatTeamPodium(champion)} (${champion})` : "TBD", colX[4] + 2, yPodium + 16);

        // 2. Subcampeón
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.setTextColor(71, 85, 105);
        doc.text("2. Subcampeón:", colX[4] + 2, yPodium + 23);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139); // Slate-500
        doc.text(runnerUp !== "TBD" ? `${formatTeamPodium(runnerUp)} (${runnerUp})` : "TBD", colX[4] + 2, yPodium + 27);

        // 3. Tercer Puesto
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.setTextColor(71, 85, 105);
        doc.text("3. Tercer Puesto:", colX[4] + 2, yPodium + 34);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(180, 83, 9); // Amber-700
        doc.text(third !== "TBD" ? `${formatTeamPodium(third)} (${third})` : "TBD", colX[4] + 2, yPodium + 38);

        // Agregar pie de página para cada usuario
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184); // Slate-400
        doc.text(`SuperQuiniela 2026 - Pág. ${index + 1} de ${pdfUsers.length}`, 10, 202);
        doc.text("Transparencia y deportividad · Todos los pronósticos están congelados al inicio del torneo.", 80, 202);
      });

      doc.save("Quiniela_2026_Pronosticos_Eliminatorias.pdf");
    } catch (err) {
      console.error("Error al generar PDF de eliminatorias:", err);
      alert("Ocurrió un error al generar el PDF de eliminatorias.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  useEffect(() => {
    async function loadQuinielas() {
      try {
        // Cargar sesión del usuario actual
        const { data: { session } } = await supabase.auth.getSession();
        const username = session?.user?.user_metadata?.username || "";
        setCurrentUsername(username);
        const currentUid = session?.user?.id || "";
        setCurrentUserId(currentUid);

        // Verificar si este usuario ya tiene una quiniela registrada (pendiente o aprobada)
        let myRow: any = null;
        if (session?.user) {
          const { data: userQ } = await supabase
            .from("user_quinielas")
            .select("user_id, status, predictions, knockout_predictions, alias_name, profiles(username, total_points)")
            .eq("user_id", session.user.id)
            .maybeSingle();
            
          if (userQ) {
            myRow = userQ;
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

        const { data, error } = await supabase
          .from("user_quinielas")
          .select(`
            user_id,
            predictions,
            knockout_predictions,
            alias_name,
            status,
            profiles (username, total_points)
          `)
          .eq("status", "approved");
        
        if (error) throw error;

        // Cargar los marcadores oficiales guardados por el administrador
        const { data: officialMatchesData, error: officialError } = await supabase
          .from("official_matches")
          .select("*");

        if (officialError) {
          console.error("Error al cargar partidos oficiales:", officialError);
        }

        const officialMatches = officialMatchesData || [];

        // Construir mapa de resultados oficiales para acceso rápido
        const offMap: Record<string, { home_goals: number; away_goals: number }> = {};
        officialMatches.forEach((om: any) => {
          offMap[om.match_id] = { home_goals: om.home_goals, away_goals: om.away_goals };
        });
        setOfficialMatchesMap(offMap);
 
        const approvedRows = data || [];
        const allRows = [...approvedRows];
        if (myRow && !allRows.some((r: any) => r.user_id === myRow.user_id)) {
          allRows.push({
            user_id: currentUid,
            predictions: myRow.predictions,
            knockout_predictions: myRow.knockout_predictions,
            alias_name: myRow.alias_name,
            status: myRow.status,
            profiles: myRow.profiles
          });
        }

        const formattedUsers: UserQuinielaData[] = allRows.map((row: any) => {
          const groupResults = getGroupResults(row.predictions || {});
          const resolvedKnockout = resolveKnockoutBracket(groupResults, row.knockout_predictions || {});
          
          let championCode = "TBD";
          let runnerUpCode = "TBD";
 
          const finalMatch = ALL_KNOCKOUT_MATCHES.find((m) => m.round === "FINAL");
          if (finalMatch) {
             const finalResolved = resolvedKnockout[finalMatch.id];
             const pred = (row.knockout_predictions || {})[finalMatch.id];
             
             if (finalResolved && pred && pred.homeGoals !== null && pred.awayGoals !== null) {
                if (pred.homeGoals > pred.awayGoals) {
                  championCode = finalResolved.home;
                  runnerUpCode = finalResolved.away;
                } else {
                  championCode = finalResolved.away;
                  runnerUpCode = finalResolved.home;
                }
             }
          }

          // Calcular puntos de forma dinámica usando el motor de puntuación unificado
          const scoring = calculateUserPoints(
            row.predictions || {},
            row.knockout_predictions || {},
            officialMatches
          );
          let calculatedPoints = scoring.totalPoints;
 
          return {
            id: row.user_id,
            username: row.profiles?.username || "Usuario",
            aliasName: row.alias_name || "",
            points: calculatedPoints, // Mostrar puntos en tiempo real calculados dinámicamente
            predictions: row.predictions || {},
            knockoutPredictions: row.knockout_predictions || {},
            championCode,
            runnerUpCode,
            status: row.status
          };
        });

        formattedUsers.sort((a, b) => b.points - a.points);

        // Mover la quiniela del usuario logueado a la primera posición
        if (session?.user) {
          const myIndex = formattedUsers.findIndex(u => u.id === session.user.id);
          if (myIndex > -1) {
            const [myQ] = formattedUsers.splice(myIndex, 1);
            formattedUsers.unshift(myQ);
          }
        }

        setUsers(formattedUsers);
        if (formattedUsers.length >= 2) {
           setCompareA(formattedUsers[0].id);
           setCompareB(formattedUsers[1].id);
        } else if (formattedUsers.length === 1) {
           setCompareA(formattedUsers[0].id);
        }
      } catch (err) {
        console.error("Error loading quinielas:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadQuinielas();
  }, []);

  // Calcular bracket del usuario seleccionado
  const resolvedUserBracket = useMemo(() => {
    if (!selectedUser) return null;
    const groupResults = getGroupResults(selectedUser.predictions);
    return resolveKnockoutBracket(groupResults, selectedUser.knockoutPredictions);
  }, [selectedUser]);

  // Si está oculto y no es el administrador, mostramos pantalla premium de espera
  if (!isLoading && !quinielasVisible && currentUsername.toLowerCase() !== "vicdaddy") {
    return (
      <div className="max-w-xl mx-auto py-24 px-4 text-center animate-in zoom-in-95 duration-500">
        <div className="w-24 h-24 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-yellow-500/30 animate-pulse">
          <EyeOff size={44} className="text-yellow-500" />
        </div>
        <h1 className="text-3xl font-extrabold text-content mb-4 tracking-tight">Predicciones Ocultas</h1>
        <p className="text-content-muted mb-4 text-lg">
          Las quinielas de todos los participantes están <strong className="text-yellow-500">ocultas temporalmente</strong> por decisión del administrador.
        </p>
        <p className="text-content-muted mb-8 text-base leading-relaxed">
          Se harán públicas de forma automática al comenzar el primer partido del torneo para garantizar la transparencia y evitar copias.{" "}
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
    <div className="max-w-7xl mx-auto pb-12 animate-in fade-in duration-500">
      
      {/* Header removed as per user request */}

      {/* Widget: Partidos del Día */}
      <div className="mb-8 glass-panel p-5 relative overflow-hidden bg-panel/40 backdrop-blur-md">
        {/* Decorative subtle background glowing circle */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-36 h-36 rounded-full bg-brand/10 blur-2xl pointer-events-none"></div>
        
        {/* Header with Calendar Icon and Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line/50 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
              <Calendar size={20} />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-content tracking-tight">Partidos del Día</h2>
              <p className="text-xs text-content-muted mt-0.5">Sigue los resultados oficiales y tus pronósticos en vivo</p>
            </div>
          </div>

          {/* Date Selector Paginator */}
          <div className="flex items-center bg-base border border-line rounded-xl p-1 shadow-inner max-w-sm sm:w-auto w-full justify-between">
            <button
              onClick={handlePrevDate}
              disabled={activeDateIndex <= 0}
              className="p-2 rounded-lg text-content-muted hover:text-content hover:bg-panel disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-content-muted transition-all select-none cursor-pointer disabled:cursor-not-allowed"
              title="Día anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-bold text-content px-3 text-center truncate select-none flex-1 min-w-[140px]">
              {currentDateLabel}
            </span>
            <button
              onClick={handleNextDate}
              disabled={activeDateIndex >= tournamentDates.length - 1}
              className="p-2 rounded-lg text-content-muted hover:text-content hover:bg-panel disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-content-muted transition-all select-none cursor-pointer disabled:cursor-not-allowed"
              title="Día siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Matches Grid */}
        {(() => {
          const { groupMatches, knockoutMatches } = matchesOfTheDay;
          const allMatchesToday = [...groupMatches, ...knockoutMatches];

          if (allMatchesToday.length === 0) {
            return (
              <div className="text-center py-12 bg-base/30 rounded-xl border border-dashed border-line/60">
                <Calendar size={32} className="text-content-muted/30 mx-auto mb-3" />
                <p className="text-content-muted text-sm font-medium">No hay partidos programados para esta fecha.</p>
              </div>
            );
          }

          return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {allMatchesToday.map((match) => {
                const isKO = match.id.startsWith("M");
                const teams = getMatchTeams(match);
                const official = officialMatchesMap[match.id];
                
                // Get prediction for this match
                const pred = isKO 
                  ? myQuiniela?.knockoutPredictions?.[match.id]
                  : myQuiniela?.predictions?.[match.id];
                
                const predExists = pred && pred.homeGoals !== null && pred.awayGoals !== null;

                // Points calculation
                let pts: number | null = null;
                let scoring: any = null;
                if (predExists && official) {
                  pts = calculateMatchPoints(pred.homeGoals!, pred.awayGoals!, official.home_goals, official.away_goals);
                  scoring = getDetailedMatchScoring(pred.homeGoals!, pred.awayGoals!, official.home_goals, official.away_goals);
                }

                // Points badge colors
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

                const matchHeaderLabel = isKO 
                  ? (ROUND_NAMES[(match as any).round] || (match as any).round)
                  : `Grupo ${(match as any).group}`;

                return (
                  <div 
                    key={match.id}
                    className="glass-card bg-card/60 hover:bg-card border-line/60 hover:border-line transition-all duration-300 p-4 flex flex-col justify-between"
                  >
                    {/* Card Top: Round Name, Match ID, and time */}
                    <div className="flex items-center justify-between border-b border-line/40 pb-2 mb-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-brand uppercase tracking-wider">{matchHeaderLabel}</span>
                        <span className="text-[9px] text-content-muted leading-none mt-0.5">{match.id}</span>
                      </div>
                      <span className="text-[10px] font-semibold text-content-muted bg-panel/80 px-2 py-0.5 rounded border border-line/40">
                        {MATCH_SCHEDULES[match.id]?.time || ""}
                      </span>
                    </div>

                    {/* Card Core: Teams and flags */}
                    <div className="space-y-3 flex-1 flex flex-col justify-center my-1">
                      {/* Home Team */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {teams.homeTeam ? (
                            <>
                              <Flag iso2={teams.homeTeam.iso2} name={teams.homeTeam.name} size="sm" />
                              <span className="text-xs font-semibold text-content truncate">{teams.homeTeam.name}</span>
                            </>
                          ) : (
                            <>
                              <span className="w-5 h-4 rounded bg-line/40 shrink-0"></span>
                              <span className="text-xs text-content-muted italic truncate">
                                {teams.homeSlot ? `Por definir (${teams.homeSlot})` : "TBD"}
                              </span>
                            </>
                          )}
                        </div>
                        {official && (
                          <span className="text-xs font-bold text-content bg-panel px-1.5 py-0.5 rounded border border-line/50">
                            {official.home_goals}
                          </span>
                        )}
                      </div>

                      {/* Versus / Divider */}
                      <div className="flex items-center gap-2">
                        <div className="h-[1px] bg-line/30 flex-1"></div>
                        <span className="text-[9px] font-bold text-content-muted uppercase tracking-widest shrink-0">VS</span>
                        <div className="h-[1px] bg-line/30 flex-1"></div>
                      </div>

                      {/* Away Team */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {teams.awayTeam ? (
                            <>
                              <Flag iso2={teams.awayTeam.iso2} name={teams.awayTeam.name} size="sm" />
                              <span className="text-xs font-semibold text-content truncate">{teams.awayTeam.name}</span>
                            </>
                          ) : (
                            <>
                              <span className="w-5 h-4 rounded bg-line/40 shrink-0"></span>
                              <span className="text-xs text-content-muted italic truncate">
                                {teams.awaySlot ? `Por definir (${teams.awaySlot})` : "TBD"}
                              </span>
                            </>
                          )}
                        </div>
                        {official && (
                          <span className="text-xs font-bold text-content bg-panel px-1.5 py-0.5 rounded border border-line/50">
                            {official.away_goals}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card Footer: Prediction & points */}
                    <div className="mt-4 pt-3 border-t border-line/40 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-content-muted font-semibold uppercase">Tu Pronóstico:</span>
                        {currentUserId ? (
                          predExists ? (
                            <span className="text-xs font-extrabold text-content bg-base/50 px-2 py-0.5 rounded border border-line/50">
                              {pred.homeGoals} - {pred.awayGoals}
                            </span>
                          ) : (
                            <span className="text-[10px] text-yellow-500/80 font-semibold italic">Sin pronosticar</span>
                          )
                        ) : (
                          <span className="text-[9px] text-content-muted italic">Inicia sesión</span>
                        )}
                      </div>

                      {/* Points badge if result is available */}
                      {official && (
                        <div className="flex items-center justify-between gap-2 border-t border-dashed border-line/30 pt-2">
                          <span className="text-[9px] text-content-muted font-bold uppercase">Resultado:</span>
                          {predExists ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${pointsColor}`}>
                              <span>+{pts} pts</span>
                              <span>·</span>
                              <span>{pointsLabel}</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-content-muted bg-panel/30 border border-line/50 px-2 py-0.5 rounded-full font-medium">
                              Sin puntos
                            </span>
                          )}
                        </div>
                      )}

                      {/* Sección de Tendencias de la Comunidad */}
                      {(() => {
                        const stats = getMatchCommunityStats(match.id, isKO);
                        return (
                          <div className="mt-3 pt-3 border-t border-line/30 flex flex-col gap-2">
                            <div className="flex items-center justify-between text-[10px] text-content-muted font-bold uppercase">
                              <span>Comunidad:</span>
                              {stats.total > 0 ? (
                                <button
                                  onClick={() => setSelectedMatchForStats(match)}
                                  className="flex items-center gap-1 text-brand hover:text-brand-hover hover:underline transition-all font-semibold cursor-pointer"
                                >
                                  <Users size={11} />
                                  Ver todos ({stats.total})
                                </button>
                              ) : (
                                <span className="italic normal-case font-normal text-[9px]">Sin datos</span>
                              )}
                            </div>

                            {stats.total > 0 && (
                              <div className="space-y-1.5">
                                {/* Barra de porcentajes tricolor */}
                                <div className="w-full h-2 rounded-full overflow-hidden bg-line/20 flex shadow-inner">
                                  {stats.localPct > 0 && (
                                    <div 
                                      className="h-full bg-emerald-500 transition-all duration-500" 
                                      style={{ width: `${stats.localPct}%` }}
                                      title={`Local: ${stats.localPct}%`}
                                    />
                                  )}
                                  {stats.drawPct > 0 && (
                                    <div 
                                      className="h-full bg-slate-400 transition-all duration-500" 
                                      style={{ width: `${stats.drawPct}%` }}
                                      title={`Empate: ${stats.drawPct}%`}
                                    />
                                  )}
                                  {stats.awayPct > 0 && (
                                    <div 
                                      className="h-full bg-blue-500 transition-all duration-500" 
                                      style={{ width: `${stats.awayPct}%` }}
                                      title={`Visitante: ${stats.awayPct}%`}
                                    />
                                  )}
                                </div>

                                {/* Etiquetas detalladas */}
                                <div className="flex items-center justify-between text-[9px] text-content-muted leading-tight font-medium">
                                  <span>{teams.homeTeam?.code || "L"}: {stats.localPct}%</span>
                                  <span>Empate: {stats.drawPct}%</span>
                                  <span>{teams.awayTeam?.code || "V"}: {stats.awayPct}%</span>
                                </div>

                                {stats.consensoScore && (
                                  <div className="text-[9px] text-center text-brand/90 font-semibold mt-0.5">
                                    Consenso: {stats.consensoScore.replace("-", " - ")} ({stats.consensoPct}%)
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Onboarding Prompts */}
      {currentUsername && quinielaStatus === null && (
        <div className="mb-8 bg-brand/10 border border-brand/30 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_0_20px_rgba(0,176,107,0.05)]">
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
        <div className="mb-8 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_0_20px_rgba(234,179,8,0.05)]">
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

      {/* View Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line mb-8 pb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("feed")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              viewMode === "feed"
                ? "bg-brand text-white shadow-[0_0_15px_rgba(0,176,107,0.3)]"
                : "text-content-muted hover:bg-panel hover:text-content"
            }`}
          >
            <Users size={18} /> Explorar Quinielas
          </button>
          <button
            onClick={() => setViewMode("compare")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              viewMode === "compare"
                ? "bg-brand text-white shadow-[0_0_15px_rgba(0,176,107,0.3)]"
                : "text-content-muted hover:bg-panel hover:text-content"
            }`}
          >
            <Swords size={18} /> Comparar Cara a Cara
          </button>
        </div>

        {/* PDF Download Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={downloadGroupPredictionsPDF}
            disabled={isGeneratingPDF || isLoading || users.length === 0}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-600/40 text-white rounded-lg text-xs font-bold transition-all shadow-[0_0_12px_rgba(220,38,38,0.25)] active:scale-95 disabled:scale-100 disabled:opacity-50 select-none cursor-pointer disabled:cursor-not-allowed"
          >
            {isGeneratingPDF ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span className="animate-pulse">{pdfStep}</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                <span>Descargar PDF Grupos</span>
              </>
            )}
          </button>
          
          <button
            onClick={downloadKnockoutPredictionsPDF}
            disabled={isGeneratingPDF || isLoading || users.length === 0}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-600/40 text-white rounded-lg text-xs font-bold transition-all shadow-[0_0_12px_rgba(220,38,38,0.25)] active:scale-95 disabled:scale-100 disabled:opacity-50 select-none cursor-pointer disabled:cursor-not-allowed"
          >
            {isGeneratingPDF ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span className="animate-pulse">{pdfStep}</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                <span>Descargar PDF Eliminatorias</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* =========================================
          VISTA 1: FEED DE JUGADORES
      ========================================= */}
      {viewMode === "feed" && (
        <>
          {/* Search Bar */}
          {!isLoading && users.length > 0 && (
            <div className="mb-6 relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search size={16} className="text-content-muted" />
              </div>
              <input
                type="text"
                value={feedSearchQuery}
                onChange={(e) => setFeedSearchQuery(e.target.value)}
                placeholder="Buscar quiniela por nombre de usuario..."
                className="w-full bg-base border border-line rounded-xl pl-10 pr-10 py-2.5 text-sm text-content placeholder:text-content-muted/60 focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-colors"
              />
              {feedSearchQuery && (
                <button
                  onClick={() => setFeedSearchQuery("")}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-content-muted hover:text-content transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            <div className="col-span-full text-center py-12">
               <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
               <p className="text-content-muted">Cargando predicciones de la liga...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <div className="w-16 h-16 bg-panel rounded-full flex items-center justify-center mx-auto mb-4 border border-line">
                <Trophy size={28} className="text-brand/50" />
              </div>
              <h3 className="text-xl font-bold text-content">El torneo está vacío</h3>
              <p className="text-content-muted mt-2">Nadie ha inscrito su quiniela aún. ¡Aprovecha y sé el primero!</p>
            </div>
          ) : (() => {
            const filtered = feedSearchQuery.trim()
              ? users.filter(u => u.username.toLowerCase().includes(feedSearchQuery.toLowerCase()))
              : users;
            
            if (filtered.length === 0) {
              return (
                <div className="col-span-full text-center py-12">
                  <Search size={32} className="text-content-muted/40 mx-auto mb-3" />
                  <p className="text-content-muted font-medium">No se encontró ningún usuario con &quot;{feedSearchQuery}&quot;</p>
                  <button onClick={() => setFeedSearchQuery("")} className="text-brand text-sm font-semibold mt-2 hover:underline">Limpiar búsqueda</button>
                </div>
              );
            }
            
            return filtered.map((user) => {
            const champion = user.championCode !== "TBD" ? TEAMS[user.championCode] : null;
            const runnerUp = user.runnerUpCode !== "TBD" ? TEAMS[user.runnerUpCode] : null;
            const isMe = user.id === currentUserId;
            
            return (
              <div 
                key={user.id} 
                className={`glass-card p-5 card-hover cursor-pointer group relative overflow-hidden ${
                  isMe ? "border-brand bg-brand/5 shadow-[0_0_20px_rgba(0,176,107,0.15)]" : ""
                }`}
                onClick={() => openUserModal(user)}
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center border shrink-0 ${
                    isMe ? "bg-brand/30 border-brand" : "bg-brand/20 border-brand/50"
                  }`}>
                    <span className="text-brand font-bold text-lg">
                      {user.username.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-content text-lg group-hover:text-brand transition-colors">
                        {user.username}
                      </h3>
                      {isMe && (
                        <span className="text-[10px] font-extrabold bg-brand text-white px-2 py-0.5 rounded-full shadow-sm">
                          Tú
                        </span>
                      )}
                      {isMe && user.status && user.status !== "approved" && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          user.status === "draft" 
                            ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/30" 
                            : "bg-orange-500/20 text-orange-500 border-orange-500/30"
                        }`}>
                          {user.status === "draft" ? "Borrador" : "Pendiente"}
                        </span>
                      )}
                    </div>
                    {currentUsername.toLowerCase() === "vicdaddy" && user.aliasName && (
                      <p className="text-xs text-yellow-500 font-bold mb-0.5">
                        Apodo: {user.aliasName}
                      </p>
                    )}
                    <p className="text-xs text-brand font-medium">{user.points} Puntos</p>
                  </div>
                </div>

                <div className="bg-panel rounded-lg p-3 space-y-2 border border-line">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-content-muted font-medium">Campeón:</span>
                    <div className="flex items-center gap-1.5">
                      {champion ? (
                        <>
                          <Flag iso2={champion.iso2} name={champion.name} size="sm" />
                          <span className="text-sm font-semibold text-content">{champion.name}</span>
                        </>
                      ) : (
                        <span className="text-sm font-semibold text-content-muted">Pendiente</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-content-muted font-medium">Subcampeón:</span>
                    <div className="flex items-center gap-1.5 opacity-80">
                      {runnerUp ? (
                        <>
                          <Flag iso2={runnerUp.iso2} name={runnerUp.name} size="sm" />
                          <span className="text-xs text-content">{runnerUp.name}</span>
                        </>
                      ) : (
                        <span className="text-xs text-content-muted">Pendiente</span>
                      )}
                    </div>
                  </div>
                </div>
                
                <p className="text-center text-xs text-content-muted mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  Ver Quiniela Completa →
                </p>
              </div>
            );
          });
          })()}
        </div>
        </>
      )}

      {/* =========================================
          VISTA 2: COMPARADOR CARA A CARA
      ========================================= */}
      {viewMode === "compare" && (
        <div className="space-y-8">
          <div className="flex flex-col md:flex-row items-center gap-6 glass-panel p-6 justify-center">
            {/* User A */}
            <div className="flex-1 w-full max-w-[280px]">
              <label className="block text-xs font-bold text-content-muted uppercase mb-2">Usuario A</label>
              <select 
                value={compareA}
                onChange={(e) => setCompareA(e.target.value)}
                className="w-full bg-base border border-line rounded-lg px-4 py-3 text-content font-semibold focus:border-brand focus:ring-1 focus:ring-brand outline-none"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.username}{currentUsername.toLowerCase() === "vicdaddy" && u.aliasName ? ` (${u.aliasName})` : ""}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="shrink-0 flex flex-col items-center justify-center">
              <Swords size={32} className="text-brand/50" />
              <span className="text-xs font-bold text-content-muted uppercase mt-1">VS</span>
            </div>

            {/* User B */}
            <div className="flex-1 w-full max-w-[280px]">
              <label className="block text-xs font-bold text-content-muted uppercase mb-2">Usuario B</label>
              <select 
                value={compareB}
                onChange={(e) => setCompareB(e.target.value)}
                className="w-full bg-base border border-line rounded-lg px-4 py-3 text-content font-semibold focus:border-brand focus:ring-1 focus:ring-brand outline-none"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.username}{currentUsername.toLowerCase() === "vicdaddy" && u.aliasName ? ` (${u.aliasName})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Comparador de Partidos (Grupos + Eliminatorias) */}
          <div className="glass-card overflow-hidden">
            {/* Header con Pestañas y Filtro */}
            <div className="bg-panel px-6 py-4 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCompareTab("groups")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border ${
                    compareTab === "groups"
                      ? "bg-brand text-white border-brand shadow-[0_0_12px_rgba(0,176,107,0.25)]"
                      : "bg-panel text-content-muted border-line hover:text-content"
                  }`}
                >
                  Fase de Grupos (72 partidos)
                </button>
                <button
                  type="button"
                  onClick={() => setCompareTab("knockout")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border ${
                    compareTab === "knockout"
                      ? "bg-brand text-white border-brand shadow-[0_0_12px_rgba(0,176,107,0.25)]"
                      : "bg-panel text-content-muted border-line hover:text-content"
                  }`}
                >
                  Fase de Eliminatorias (32 partidos)
                </button>
              </div>

              {/* Filtro de Grupos (Solo si Fase de Grupos está activa) */}
              {compareTab === "groups" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-content-muted uppercase">Filtrar:</span>
                  <select
                    value={compareGroupFilter}
                    onChange={(e) => setCompareGroupFilter(e.target.value)}
                    className="bg-base border border-line rounded-lg px-3 py-1.5 text-xs text-content font-semibold focus:border-brand focus:ring-1 focus:ring-brand outline-none"
                  >
                    <option value="all">Todos los Grupos</option>
                    {GROUP_NAMES.map((g) => (
                      <option key={g} value={g}>
                        Grupo {g}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Listado Comparativo */}
            <div className="divide-y divide-line/50">
              {(() => {
                const userA = users.find((u) => u.id === compareA);
                const userB = users.find((u) => u.id === compareB);

                const userAGroupResults = userA ? getGroupResults(userA.predictions) : {};
                const userBGroupResults = userB ? getGroupResults(userB.predictions) : {};
                const userAResolved = userA ? resolveKnockoutBracket(userAGroupResults, userA.knockoutPredictions) : {};
                const userBResolved = userB ? resolveKnockoutBracket(userBGroupResults, userB.knockoutPredictions) : {};

                // Resolviendo el bracket oficial
                const officialGroupPreds: Record<string, MatchPrediction> = {};
                const officialKOPreds: Record<string, MatchPrediction> = {};
                Object.entries(officialMatchesMap).forEach(([id, om]) => {
                  if (id.startsWith("M")) {
                    officialKOPreds[id] = { matchId: id, homeGoals: om.home_goals, awayGoals: om.away_goals };
                  } else {
                    officialGroupPreds[id] = { matchId: id, homeGoals: om.home_goals, awayGoals: om.away_goals };
                  }
                });
                const officialGroupResults = getGroupResults(officialGroupPreds);
                const officialResolved = resolveKnockoutBracket(officialGroupResults, officialKOPreds);

                const getMatchPoints = (matchId: string, userPreds: Record<string, MatchPrediction> | undefined) => {
                  if (!userPreds) return 0;
                  const pred = userPreds[matchId];
                  const official = officialMatchesMap[matchId];
                  if (!pred || pred.homeGoals === null || pred.awayGoals === null || !official) {
                    return 0;
                  }
                  return calculateMatchPoints(pred.homeGoals, pred.awayGoals, official.home_goals, official.away_goals);
                };

                const renderPointsBadge = (
                  points: number, 
                  pred: MatchPrediction | undefined, 
                  official: any
                ) => {
                  if (!pred || pred.homeGoals === null || pred.awayGoals === null) {
                    return <span className="text-[10px] text-content-muted bg-panel/30 border border-line/50 px-2 py-0.5 rounded-full font-medium">Sin pronosticar</span>;
                  }
                  if (!official) {
                    return <span className="text-[10px] text-content-muted bg-panel/30 border border-line/50 px-2 py-0.5 rounded-full font-medium">Pendiente</span>;
                  }
                  
                  const scoring = getDetailedMatchScoring(pred.homeGoals, pred.awayGoals, official.home_goals, official.away_goals);
                  const pointsColor = scoring.isExactScore ? "text-emerald-400 bg-emerald-500/20 border-emerald-500/40"
                    : scoring.isWinnerGuessed || scoring.isTieGuessed ? "text-green-400 bg-green-500/15 border-green-500/30"
                    : scoring.isConsolation ? "text-yellow-400 bg-yellow-500/15 border-yellow-500/30"
                    : "text-red-400 bg-red-500/15 border-red-500/30";
                  
                  const pointsLabel = scoring.isExactScore ? "Exacto"
                    : scoring.isWinnerGuessed ? "Ganador"
                    : scoring.isTieGuessed ? "Empate"
                    : scoring.isConsolation ? "Cercano"
                    : "Errado";

                  return (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${pointsColor} shrink-0`}>
                      <span>+{points} pts</span>
                      <span className="hidden sm:inline">·</span>
                      <span className="hidden sm:inline">{pointsLabel}</span>
                    </span>
                  );
                };

                const renderDiffBadge = (ptsA: number, ptsB: number, official: any) => {
                  if (!official) return null;
                  const diff = ptsA - ptsB;
                  if (diff > 0) {
                    return (
                      <span className="text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-lg shrink-0 flex items-center shadow-sm">
                        <span>← +{diff}</span>
                      </span>
                    );
                  }
                  if (diff < 0) {
                    return (
                      <span className="text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-lg shrink-0 flex items-center shadow-sm">
                        <span>+{Math.abs(diff)} →</span>
                      </span>
                    );
                  }
                  return (
                    <span className="text-[10px] font-bold bg-panel text-content-muted border border-line px-2.5 py-1 rounded-lg shrink-0">
                      0
                    </span>
                  );
                };

                const getComparisonStyle = (predA?: MatchPrediction, predB?: MatchPrediction) => {
                  if (!predA || !predB || predA.homeGoals === null || predA.awayGoals === null || predB.homeGoals === null || predB.awayGoals === null) {
                    return "hover:bg-panel/30 border-y border-transparent";
                  }
                  if (predA.homeGoals === predB.homeGoals && predA.awayGoals === predB.awayGoals) {
                    return "bg-emerald-950/15 hover:bg-emerald-950/25 border-y border-emerald-500/25";
                  }
                  const winnerA = predA.homeGoals > predA.awayGoals ? "home" : predA.homeGoals < predA.awayGoals ? "away" : "tie";
                  const winnerB = predB.homeGoals > predB.awayGoals ? "home" : predB.homeGoals < predB.awayGoals ? "away" : "tie";
                  if (winnerA === winnerB) {
                    return "bg-yellow-950/10 hover:bg-yellow-950/20 border-y border-yellow-500/15";
                  }
                  return "bg-red-950/10 hover:bg-red-950/20 border-y border-red-500/15";
                };

                const matchesToRender = compareTab === "groups"
                  ? ALL_GROUP_MATCHES.filter((m) => compareGroupFilter === "all" || m.group === compareGroupFilter)
                  : ALL_KNOCKOUT_MATCHES;

                if (matchesToRender.length === 0) {
                  return (
                    <div className="p-8 text-center text-content-muted">
                      No hay partidos que coincidan con el filtro seleccionado.
                    </div>
                  );
                }

                return matchesToRender.map((match) => {
                  const isKO = match.id.startsWith("M");
                  // Siempre usar la fuente oficial para los equipos reales del partido
                  const matchHomeCode = isKO ? officialResolved[match.id]?.home : (match as any).homeTeam;
                  const matchAwayCode = isKO ? officialResolved[match.id]?.away : (match as any).awayTeam;

                  const homeA = matchHomeCode ? TEAMS[matchHomeCode] : null;
                  const awayA = matchAwayCode ? TEAMS[matchAwayCode] : null;
                  const homeB = matchHomeCode ? TEAMS[matchHomeCode] : null;
                  const awayB = matchAwayCode ? TEAMS[matchAwayCode] : null;

                  const userAPred = userA ? (isKO ? userA.knockoutPredictions[match.id] : userA.predictions[match.id]) : undefined;
                  const userBPred = userB ? (isKO ? userB.knockoutPredictions[match.id] : userB.predictions[match.id]) : undefined;

                  const ptsA = getMatchPoints(match.id, isKO ? userA?.knockoutPredictions : userA?.predictions);
                  const ptsB = getMatchPoints(match.id, isKO ? userB?.knockoutPredictions : userB?.predictions);
                  const official = officialMatchesMap[match.id];

                  return (
                    <div
                      key={match.id}
                      className={`p-3 md:p-4 transition-colors ${getComparisonStyle(userAPred, userBPred)}`}
                    >
                      {/* ===== MOBILE LAYOUT (< md) ===== */}
                      <div className="md:hidden space-y-2">
                        {/* Match Header: Teams + Official */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            {homeA ? (
                              <>
                                <Flag iso2={homeA.iso2} name={homeA.name} size="sm" />
                                <span className="font-bold text-content text-xs">{matchHomeCode}</span>
                              </>
                            ) : (
                              <span className="text-[10px] text-content-muted">Equipo indefinido</span>
                            )}
                            <span className="text-content-muted text-[10px] font-bold">vs</span>
                            {awayA ? (
                              <>
                                <Flag iso2={awayA.iso2} name={awayA.name} size="sm" />
                                <span className="font-bold text-content text-xs">{matchAwayCode}</span>
                              </>
                            ) : (
                              <span className="text-[10px] text-content-muted">Equipo indefinido</span>
                            )}
                          </div>
                          {/* Match ID + Official */}
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[9px] font-bold text-brand uppercase">{match.id}</span>
                            {official ? (
                              <span className="text-[10px] font-extrabold text-content bg-base border border-line px-1.5 py-0.5 rounded">
                                {official.home_goals}-{official.away_goals}
                              </span>
                            ) : (
                              <span className="text-[9px] text-content-muted font-bold bg-base border border-line/40 px-1 py-0.5 rounded">Equipo indefinido</span>
                            )}
                          </div>
                        </div>

                        {/* User Predictions Side by Side */}
                        <div className="flex items-stretch gap-2">
                          {/* User A */}
                          <div className="flex-1 flex items-center justify-between gap-1.5 bg-base/50 rounded-lg px-2.5 py-1.5 border border-line/30">
                            <span className="text-[10px] text-content-muted font-bold truncate max-w-[60px]">{userA?.username?.split(' ')[0] ?? "A"}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-xs font-extrabold text-content">
                                {userAPred?.homeGoals ?? "-"}:{userAPred?.awayGoals ?? "-"}
                              </span>
                              {renderPointsBadge(ptsA, userAPred, official)}
                            </div>
                          </div>
                          {/* User B */}
                          <div className="flex-1 flex items-center justify-between gap-1.5 bg-base/50 rounded-lg px-2.5 py-1.5 border border-line/30">
                            <span className="text-[10px] text-content-muted font-bold truncate max-w-[60px]">{userB?.username?.split(' ')[0] ?? "B"}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-xs font-extrabold text-content">
                                {userBPred?.homeGoals ?? "-"}:{userBPred?.awayGoals ?? "-"}
                              </span>
                              {renderPointsBadge(ptsB, userBPred, official)}
                            </div>
                          </div>
                        </div>
                        {/* Diff Badge Mobile */}
                        {official && (
                          <div className="flex justify-center">
                            {renderDiffBadge(ptsA, ptsB, official)}
                          </div>
                        )}
                      </div>

                      {/* ===== DESKTOP LAYOUT (>= md) ===== */}
                      <div className="hidden md:flex items-center justify-between gap-4">
                        {/* Usuario A */}
                        <div className="flex-1 flex items-center justify-end gap-3">
                          <div className="flex items-center gap-2 min-w-0 justify-end flex-1">
                            {homeA ? (
                              <>
                                <span className="font-semibold text-content text-sm truncate">{homeA.name}</span>
                                <Flag iso2={homeA.iso2} name={homeA.name} size="md" />
                              </>
                            ) : (
                              <span className="text-[10px] text-content-muted italic">Equipo indefinido</span>
                            )}
                            <span className="text-content-muted font-bold text-xs mx-1">vs</span>
                            {awayA ? (
                              <>
                                <Flag iso2={awayA.iso2} name={awayA.name} size="md" />
                                <span className="font-semibold text-content text-sm truncate">{awayA.name}</span>
                              </>
                            ) : (
                              <span className="text-[10px] text-content-muted italic">Equipo indefinido</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            <div className="flex items-center gap-1 bg-base px-2 py-1 rounded border border-line text-xs font-extrabold text-content shadow-sm">
                              <span>{userAPred?.homeGoals ?? "-"}</span>
                              <span className="text-content-muted">:</span>
                              <span>{userAPred?.awayGoals ?? "-"}</span>
                            </div>
                            {renderPointsBadge(ptsA, userAPred, official)}
                          </div>
                        </div>

                        {/* Resultado Oficial + Diferencia */}
                        <div className="shrink-0 flex flex-col items-center justify-center px-4 bg-panel/35 py-2 rounded-2xl border border-line/40 gap-1.5 w-28 shadow-sm">
                          <span className="text-[10px] font-bold text-brand uppercase tracking-wider">{match.id}</span>
                          {official ? (
                            <div className="flex items-center gap-1 text-xs font-extrabold text-content bg-base border border-line px-2.5 py-1 rounded-lg shadow-inner">
                              {official.home_goals} - {official.away_goals}
                            </div>
                          ) : (
                            <span className="text-[9px] text-content-muted font-bold bg-base border border-line/40 px-2 py-0.5 rounded-md text-center leading-tight">Equipo indefinido</span>
                          )}
                          {renderDiffBadge(ptsA, ptsB, official)}
                        </div>

                        {/* Usuario B */}
                        <div className="flex-1 flex items-center justify-start gap-3">
                          <div className="flex items-center gap-2 shrink-0 mr-3">
                            {renderPointsBadge(ptsB, userBPred, official)}
                            <div className="flex items-center gap-1 bg-base px-2 py-1 rounded border border-line text-xs font-extrabold text-content shadow-sm">
                              <span>{userBPred?.homeGoals ?? "-"}</span>
                              <span className="text-content-muted">:</span>
                              <span>{userBPred?.awayGoals ?? "-"}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {homeB ? (
                              <>
                                <Flag iso2={homeB.iso2} name={homeB.name} size="md" />
                                <span className="font-semibold text-content text-sm truncate">{homeB.name}</span>
                              </>
                            ) : (
                              <span className="text-[10px] text-content-muted italic">Equipo indefinido</span>
                            )}
                            <span className="text-content-muted font-bold text-xs mx-1">vs</span>
                            {awayB ? (
                              <>
                                <Flag iso2={awayB.iso2} name={awayB.name} size="md" />
                                <span className="font-semibold text-content text-sm truncate">{awayB.name}</span>
                              </>
                            ) : (
                              <span className="text-[10px] text-content-muted italic">Equipo indefinido</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            
            {/* Pie de Página */}
            <div className="p-4 text-center bg-panel/30 border-t border-line/50">
              <p className="text-xs text-content-muted">
                Comparando todos los pronósticos y diferencias en tiempo real.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Estadísticas y Muro de Pronósticos del Partido */}
      {selectedMatchForStats && (() => {
        const match = selectedMatchForStats;
        const isKO = match.id.startsWith("M");
        const teams = getMatchTeams(match);
        const official = officialMatchesMap[match.id];
        const stats = getMatchCommunityStats(match.id, isKO);
        
        // Filtrar los usuarios que tienen predicción para este partido
        const userPreds = users
          .map(u => {
            const pred = isKO ? u.knockoutPredictions?.[match.id] : u.predictions?.[match.id];
            return {
              user: u,
              pred,
              hasPred: pred && pred.homeGoals !== null && pred.awayGoals !== null
            };
          })
          // Ordenar de forma que los que tienen predicción vayan primero, ordenados por puntos de mayor a menor
          .sort((a, b) => b.user.points - a.user.points);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-dark/80 backdrop-blur-md p-4">
            <div className="glass-panel w-full max-w-lg max-h-[85vh] flex flex-col border border-line overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              
              {/* Cabecera del modal */}
              <div className="flex items-center justify-between border-b border-line p-4 bg-panel/30">
                <div className="flex items-center gap-2">
                  <BarChart3 size={18} className="text-brand animate-pulse" />
                  <span className="text-sm font-bold text-content uppercase tracking-wider">Pronósticos de la Comunidad</span>
                </div>
                <button
                  onClick={() => setSelectedMatchForStats(null)}
                  className="p-1.5 rounded-lg text-content-muted hover:text-content hover:bg-panel transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Contenido con scroll */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                
                {/* Enfrentamiento principal */}
                <div className="bg-panel/20 border border-line/50 rounded-2xl p-4 flex flex-col items-center">
                  <span className="text-[10px] font-bold text-brand uppercase tracking-wider mb-2">
                    {isKO ? (ROUND_NAMES[(match as any).round] || (match as any).round) : `Grupo ${(match as any).group}`} · {match.id}
                  </span>
                  
                  <div className="flex items-center justify-between w-full max-w-xs gap-4 my-2">
                    {/* Equipo Local */}
                    <div className="flex flex-col items-center text-center flex-1 min-w-0">
                      {teams.homeTeam ? (
                        <>
                          <Flag iso2={teams.homeTeam.iso2} name={teams.homeTeam.name} size="md" />
                          <span className="text-xs font-bold text-content mt-2 truncate w-full">{teams.homeTeam.name}</span>
                        </>
                      ) : (
                        <>
                          <span className="w-8 h-6 rounded bg-line/40 shrink-0"></span>
                          <span className="text-[10px] text-content-muted italic mt-2 truncate w-full">TBD</span>
                        </>
                      )}
                    </div>

                    {/* Versus / Marcador oficial */}
                    <div className="flex flex-col items-center justify-center">
                      {official ? (
                        <div className="flex items-center gap-2 px-3 py-1 bg-panel border border-line rounded-lg text-sm font-extrabold text-content">
                          <span>{official.home_goals}</span>
                          <span className="text-content-muted font-normal text-xs">vs</span>
                          <span>{official.away_goals}</span>
                        </div>
                      ) : (
                        <span className="text-xs font-black text-content-muted/60 tracking-wider">VS</span>
                      )}
                      <span className="text-[9px] text-content-muted font-semibold mt-1">
                        {MATCH_SCHEDULES[match.id]?.time || ""} hs
                      </span>
                    </div>

                    {/* Equipo Visitante */}
                    <div className="flex flex-col items-center text-center flex-1 min-w-0">
                      {teams.awayTeam ? (
                        <>
                          <Flag iso2={teams.awayTeam.iso2} name={teams.awayTeam.name} size="md" />
                          <span className="text-xs font-bold text-content mt-2 truncate w-full">{teams.awayTeam.name}</span>
                        </>
                      ) : (
                        <>
                          <span className="w-8 h-6 rounded bg-line/40 shrink-0"></span>
                          <span className="text-[10px] text-content-muted italic mt-2 truncate w-full">TBD</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Gráfico de barras de tendencias */}
                {stats.total > 0 ? (
                  <div className="space-y-4 bg-panel/10 border border-line/40 rounded-2xl p-4">
                    <h4 className="text-xs font-bold text-content-muted uppercase tracking-wider flex items-center gap-1.5">
                      <BarChart3 size={13} className="text-brand" /> Distribución de Tendencias
                    </h4>
                    
                    {/* Barra tricolor */}
                    <div className="w-full h-4 rounded-full overflow-hidden bg-line/20 flex shadow-inner">
                      {stats.localPct > 0 && (
                        <div 
                          className="h-full bg-emerald-500 flex items-center justify-center text-[9px] font-black text-white transition-all duration-500" 
                          style={{ width: `${stats.localPct}%` }}
                        >
                          {stats.localPct >= 15 && `${stats.localPct}%`}
                        </div>
                      )}
                      {stats.drawPct > 0 && (
                        <div 
                          className="h-full bg-slate-400 flex items-center justify-center text-[9px] font-black text-white transition-all duration-500" 
                          style={{ width: `${stats.drawPct}%` }}
                        >
                          {stats.drawPct >= 15 && `${stats.drawPct}%`}
                        </div>
                      )}
                      {stats.awayPct > 0 && (
                        <div 
                          className="h-full bg-blue-500 flex items-center justify-center text-[9px] font-black text-white transition-all duration-500" 
                          style={{ width: `${stats.awayPct}%` }}
                        >
                          {stats.awayPct >= 15 && `${stats.awayPct}%`}
                        </div>
                      )}
                    </div>

                    {/* Leyendas explicativas */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="flex flex-col p-1 bg-emerald-500/10 rounded border border-emerald-500/20">
                        <span className="text-emerald-400 font-extrabold">{stats.localPct}%</span>
                        <span className="text-[9px] text-content-muted">Gana {teams.homeTeam?.name || "Local"}</span>
                      </div>
                      <div className="flex flex-col p-1 bg-slate-500/10 rounded border border-slate-500/20">
                        <span className="text-slate-400 font-extrabold">{stats.drawPct}%</span>
                        <span className="text-[9px] text-content-muted">Empate</span>
                      </div>
                      <div className="flex flex-col p-1 bg-blue-500/10 rounded border border-blue-500/20">
                        <span className="text-blue-400 font-extrabold">{stats.awayPct}%</span>
                        <span className="text-[9px] text-content-muted">Gana {teams.awayTeam?.name || "Visitante"}</span>
                      </div>
                    </div>

                    {stats.consensoScore && (
                      <div className="pt-2 border-t border-line/30 flex items-center justify-between text-xs">
                        <span className="text-content-muted">Consenso (Marcador favorito):</span>
                        <span className="font-extrabold text-brand bg-brand/10 border border-brand/20 px-2 py-0.5 rounded">
                          {stats.consensoScore.replace("-", " - ")} ({stats.consensoPct}%)
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs text-content-muted italic">
                    Aún no hay predicciones aprobadas de la comunidad para este partido.
                  </div>
                )}

                {/* Muro de Jugadores */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-content-muted uppercase tracking-wider flex items-center gap-1.5">
                    <Users size={13} className="text-brand" /> Muro de Pronósticos ({userPreds.filter(p => p.hasPred).length})
                  </h4>
                  
                  <div className="border border-line/60 rounded-xl divide-y divide-line/40 overflow-hidden bg-base/20 max-h-60 overflow-y-auto">
                    {userPreds.map(({ user: u, pred, hasPred }, idx) => {
                      // Si el administrador está logueado, mostrar alias si lo tiene
                      const displayName = currentUsername.toLowerCase() === "vicdaddy" && u.aliasName 
                        ? `${u.username} (${u.aliasName})`
                        : u.username;

                      // Si es el usuario actual, destacamos su fila
                      const isCurrentUser = u.id === currentUserId;

                      // Puntos ganados en este partido si hay resultado
                      let matchPts: number | null = null;
                      if (hasPred && official) {
                        matchPts = calculateMatchPoints(pred!.homeGoals!, pred!.awayGoals!, official.home_goals, official.away_goals);
                      }

                      return (
                        <div 
                          key={u.id}
                          className={`flex items-center justify-between px-3.5 py-2.5 text-xs transition-colors ${
                            isCurrentUser ? "bg-brand/5 border-l-2 border-l-brand" : "hover:bg-panel/20"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] text-content-muted/80 font-mono w-4 text-right shrink-0">#{idx + 1}</span>
                            <span className={`font-semibold truncate ${isCurrentUser ? "text-brand" : "text-content"}`}>
                              {displayName}
                            </span>
                            <span className="text-[9px] text-content-muted bg-panel px-1.5 py-0.2 rounded-full shrink-0">
                              {u.points} pts
                            </span>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            {hasPred ? (
                              <>
                                <span className="font-extrabold text-content bg-base border border-line/60 px-2 py-0.5 rounded font-mono">
                                  {pred!.homeGoals} - {pred!.awayGoals}
                                </span>
                                {matchPts !== null && (
                                  <span className={`text-[10px] font-black ${
                                    matchPts > 0 ? "text-emerald-400" : "text-red-400"
                                  }`}>
                                    +{matchPts} pts
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[10px] text-content-muted/60 italic">Sin pronóstico</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Pie del modal */}
              <div className="border-t border-line p-4 bg-panel/20 flex justify-end">
                <button
                  onClick={() => setSelectedMatchForStats(null)}
                  className="btn-primary py-2 px-4 text-xs font-bold shadow-md cursor-pointer"
                >
                  Cerrar
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* =========================================
          MODAL: DETALLE DE QUINIELA DEL USUARIO
      ========================================= */}
      {selectedUser && resolvedUserBracket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-base/90 backdrop-blur-sm" onClick={() => setSelectedUser(null)}></div>
          
          <div className="relative w-full max-w-6xl max-h-[90vh] bg-card border border-line rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-line bg-panel/50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-brand/20 flex items-center justify-center border border-brand/50">
                  <span className="text-brand font-bold text-lg">
                    {selectedUser.username.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-content">Quiniela de {selectedUser.username}</h2>
                  {currentUsername.toLowerCase() === "vicdaddy" && selectedUser.aliasName && (
                    <p className="text-sm text-yellow-500 font-bold mt-0.5">
                      Apodo: {selectedUser.aliasName}
                    </p>
                  )}
                  <p className="text-sm text-brand font-medium">Torneo Mundial 2026</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedUser(null)}
                className="p-2 rounded-lg text-content-muted hover:text-white hover:bg-base transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex items-center gap-4 px-6 border-b border-line bg-panel/30">
              <button
                onClick={() => setModalTab("groups")}
                className={`py-3 text-sm font-bold border-b-2 transition-all ${
                  modalTab === "groups"
                    ? "border-brand text-brand"
                    : "border-transparent text-content-muted hover:text-content"
                }`}
              >
                Fase de Grupos
              </button>
              <button
                onClick={() => setModalTab("knockout")}
                className={`py-3 text-sm font-bold border-b-2 transition-all ${
                  modalTab === "knockout"
                    ? "border-brand text-brand"
                    : "border-transparent text-content-muted hover:text-content"
                }`}
              >
                Fase de Eliminatorias
              </button>
            </div>

            {/* Group selector inside Modal (only for groups tab) */}
            {modalTab === "groups" && (
              <div className="flex overflow-x-auto px-6 py-3 border-b border-line/50 gap-2 bg-panel/10 hide-scrollbar shrink-0">
                {GROUP_NAMES.map((g, idx) => (
                  <button
                    key={g}
                    onClick={() => setModalGroupIndex(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                      idx === modalGroupIndex
                        ? "bg-brand text-white shadow-sm"
                        : "bg-panel text-content-muted hover:text-content border border-line"
                    }`}
                  >
                    Grupo {g}
                  </button>
                ))}
              </div>
            )}

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {modalTab === "groups" ? (
                (() => {
                  const groupKey = GROUP_NAMES[modalGroupIndex];
                  const groupMatches = getGroupMatches(groupKey);
                  const standings = calculateGroupStandings(groupKey, selectedUser.predictions);

                  // Calcular puntos acumulados por grupo
                  let groupMatchPoints = 0;
                  let groupMatchesCount = 0;
                  groupMatches.forEach((match) => {
                    const pred = selectedUser.predictions[match.id];
                    const official = officialMatchesMap[match.id];
                    if (pred && official && pred.homeGoals !== null && pred.awayGoals !== null) {
                      groupMatchPoints += calculateMatchPoints(
                        pred.homeGoals,
                        pred.awayGoals,
                        official.home_goals,
                        official.away_goals
                      );
                      groupMatchesCount++;
                    }
                  });

                  let groupPosPoints = 0;
                  const isGroupCompleted = groupMatches.every((m) => officialMatchesMap[m.id] !== undefined);
                  if (isGroupCompleted) {
                    const userGroupResults = getGroupResults(selectedUser.predictions);
                    const officialGroupPreds: Record<string, MatchPrediction> = {};
                    Object.entries(officialMatchesMap).forEach(([id, om]) => {
                      officialGroupPreds[id] = { matchId: id, homeGoals: om.home_goals, awayGoals: om.away_goals };
                    });
                    const officialGroupResults = getGroupResults(officialGroupPreds);

                    const u1 = userGroupResults[groupKey]?.first;
                    const u2 = userGroupResults[groupKey]?.second;
                    const u3 = userGroupResults[groupKey]?.third?.teamCode;

                    const o1 = officialGroupResults[groupKey]?.first;
                    const o2 = officialGroupResults[groupKey]?.second;
                    const o3 = officialGroupResults[groupKey]?.third?.teamCode;

                    if (u1 && o1 && u1 === o1) groupPosPoints += 3;
                    if (u2 && o2 && u2 === o2) groupPosPoints += 3;
                    if (u3 && o3 && u3 === o3) groupPosPoints += 3;
                  }

                  const totalGroupPoints = groupMatchPoints + groupPosPoints;

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                      {/* Partidos Pronosticados */}
                      <div className="lg:col-span-3 space-y-4">
                        <div className="flex items-center justify-between gap-4 mb-2">
                          <h3 className="text-lg font-bold text-content">
                            Partidos Grupo {groupKey}
                          </h3>
                          {officialMatchesMap && Object.keys(officialMatchesMap).length > 0 && (
                            <div className="flex items-center gap-1.5 bg-brand/15 border border-brand/30 px-3 py-1 rounded-xl text-brand text-xs font-bold shadow-sm animate-in fade-in duration-300">
                              <span>Grupo {groupKey}:</span>
                              <span className="text-sm font-extrabold">+{totalGroupPoints} pts</span>
                              <span className="text-[10px] text-brand/80 font-normal hidden sm:inline">
                                (Partidos: +{groupMatchPoints} pts | Tabla: +{groupPosPoints} pts)
                              </span>
                            </div>
                          )}
                        </div>
                        {[1, 2, 3].map((matchday) => (
                          <div key={matchday} className="space-y-3">
                            <p className="text-xs text-content-muted uppercase tracking-wider font-semibold mt-4 first:mt-0">
                              Jornada {matchday}
                            </p>
                            <div className="space-y-3">
                              {groupMatches
                                .filter((m) => m.matchday === matchday)
                                .map((match) => {
                                  const home = TEAMS[match.homeTeam];
                                  const away = TEAMS[match.awayTeam];
                                  const pred = selectedUser.predictions[match.id];
                                  const official = officialMatchesMap[match.id];
                                  const scoring = (pred && official && pred.homeGoals !== null && pred.awayGoals !== null)
                                    ? getDetailedMatchScoring(pred.homeGoals, pred.awayGoals, official.home_goals, official.away_goals)
                                    : null;
                                  
                                  const pointsColor = scoring
                                    ? scoring.isExactScore ? "text-emerald-400 bg-emerald-500/20 border-emerald-500/40"
                                    : scoring.isWinnerGuessed || scoring.isTieGuessed ? "text-green-400 bg-green-500/15 border-green-500/30"
                                    : scoring.isConsolation ? "text-yellow-400 bg-yellow-500/15 border-yellow-500/30"
                                    : "text-red-400 bg-red-500/15 border-red-500/30"
                                    : null;
                                  
                                  const pointsLabel = scoring
                                    ? scoring.isExactScore ? "Exacto"
                                    : scoring.isWinnerGuessed ? "Ganador"
                                    : scoring.isTieGuessed ? "Empate"
                                    : scoring.isConsolation ? "Cercano"
                                    : "Errado"
                                    : null;

                                  return (
                                    <div
                                      key={match.id}
                                      className={`border rounded-xl p-3 sm:p-4 shadow-sm transition-colors ${
                                        scoring
                                          ? scoring.isExactScore 
                                            ? "bg-emerald-950/15 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.03)]" 
                                            : scoring.isWinnerGuessed || scoring.isTieGuessed
                                              ? "bg-green-950/10 border-green-500/30"
                                              : scoring.isConsolation
                                                ? "bg-yellow-950/10 border-yellow-500/30"
                                                : "bg-red-950/10 border-red-500/20"
                                          : "bg-card border-line hover:border-line-hover"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        {/* Home */}
                                        <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                                          <span className="font-semibold text-content text-xs sm:text-sm text-right truncate">
                                            {home.name}
                                          </span>
                                          <Flag iso2={home.iso2} name={home.name} size="md" />
                                        </div>

                                        {/* Score Display (Read Only) */}
                                        <div className="flex items-center gap-2 shrink-0">
                                          <div className="w-10 h-10 bg-base border border-line rounded-lg flex items-center justify-center font-bold text-base text-content shadow-inner">
                                            {pred?.homeGoals ?? "-"}
                                          </div>
                                          <span className="text-content-muted font-bold">:</span>
                                          <div className="w-10 h-10 bg-base border border-line rounded-lg flex items-center justify-center font-bold text-base text-content shadow-inner">
                                            {pred?.awayGoals ?? "-"}
                                          </div>
                                        </div>

                                        {/* Away */}
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                          <Flag iso2={away.iso2} name={away.name} size="md" />
                                          <span className="font-semibold text-content text-xs sm:text-sm truncate">
                                            {away.name}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Resultado Oficial + Puntos */}
                                      {official && scoring && (
                                        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-line/50">
                                          <div className="flex items-center gap-2 text-xs text-content-muted">
                                            <span className="font-medium">Oficial:</span>
                                            <span className="font-bold text-content">
                                              {official.home_goals} - {official.away_goals}
                                            </span>
                                          </div>
                                          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${pointsColor}`}>
                                            <span>+{scoring.points}</span>
                                            <span className="hidden sm:inline">·</span>
                                            <span className="hidden sm:inline">{pointsLabel}</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Tabla de Posiciones Resultante */}
                      <div className="lg:col-span-2 space-y-4">
                        <h3 className="text-lg font-bold text-content">Tabla de Posiciones</h3>
                        <GroupStandings standings={standings} groupName={groupKey} officialMatchesMap={officialMatchesMap} />
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-brand flex items-center gap-2 mb-4">
                    <Trophy size={20} />
                    Fase de Eliminatorias
                  </h3>
                  <KnockoutBracket
                    matches={ALL_KNOCKOUT_MATCHES}
                    resolvedBracket={resolvedUserBracket}
                    predictions={selectedUser.knockoutPredictions}
                    readOnly={true}
                    officialMatchesMap={officialMatchesMapForBracket}
                    officialResolved={officialResolved}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
