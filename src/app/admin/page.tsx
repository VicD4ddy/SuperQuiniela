"use client";

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ShieldCheck, AlertTriangle, Save, UserCheck, UserX, Clock, CheckCircle2, Eye, EyeOff, X, Trophy, Lock, Dices, Trash2 } from "lucide-react";
import { 
  ALL_GROUP_MATCHES, 
  TEAMS, 
  MatchPrediction, 
  ALL_KNOCKOUT_MATCHES, 
  getGroupResults, 
  resolveKnockoutBracket,
  GROUP_NAMES,
  getGroupMatches,
  calculateGroupStandings,
  MATCH_SCHEDULES
} from "@/lib/worldCupData";
import Flag from "@/components/ui/Flag";
import KnockoutBracket from "@/components/predictions/KnockoutBracket";
import GroupStandings from "@/components/predictions/GroupStandings";
import { calculateMatchPoints, getDetailedMatchScoring, calculateTournamentBonuses } from "@/scoringEngine";

const CHRONOLOGICAL_MATCHES = [...ALL_GROUP_MATCHES].sort((a, b) => {
  const schedA = MATCH_SCHEDULES[a.id];
  const schedB = MATCH_SCHEDULES[b.id];
  if (!schedA || !schedB) return 0;
  const dateTimeA = `${schedA.date}T${schedA.time}`;
  const dateTimeB = `${schedB.date}T${schedB.time}`;
  if (dateTimeA !== dateTimeB) {
    return dateTimeA.localeCompare(dateTimeB);
  }
  return a.id.localeCompare(b.id);
});

const CHRONOLOGICAL_KNOCKOUT_MATCHES = [...ALL_KNOCKOUT_MATCHES].sort((a, b) => {
  const schedA = MATCH_SCHEDULES[a.id];
  const schedB = MATCH_SCHEDULES[b.id];
  if (!schedA || !schedB) return 0;
  const dateTimeA = `${schedA.date}T${schedA.time}`;
  const dateTimeB = `${schedB.date}T${schedB.time}`;
  if (dateTimeA !== dateTimeB) {
    return dateTimeA.localeCompare(dateTimeB);
  }
  return a.id.localeCompare(b.id);
});

const ROUND_DESCRIPTIONS: Record<string, string> = {
  R32: "Ronda de 32 (Dieciseisavos)",
  R16: "Octavos de Final",
  QF: "Cuartos de Final",
  SF: "Semifinales",
  "3RD": "Tercer Puesto",
  FINAL: "Gran Final",
};

export default function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [results, setResults] = useState<Record<string, { homeGoals: number; awayGoals: number }>>({});
  const [loadingMatches, setLoadingMatches] = useState<Record<string, boolean>>({});
  const [savedMatches, setSavedMatches] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [adminTab, setAdminTab] = useState<"inscripciones" | "resultados">("inscripciones");
  const [resultsTab, setResultsTab] = useState<"groups" | "knockout">("groups");

  // Visibilidad global de las quinielas
  const [quinielasVisible, setQuinielasVisible] = useState<boolean>(false);
  const [savingVisibility, setSavingVisibility] = useState<boolean>(false);

  // Gestión de bloqueos (inscripciones y ediciones)
  const [blockRegistrations, setBlockRegistrations] = useState<boolean>(false);
  const [savingRegistrations, setSavingRegistrations] = useState<boolean>(false);
  const [blockEdits, setBlockEdits] = useState<boolean>(false);
  const [savingEdits, setSavingEdits] = useState<boolean>(false);
  const [blockEditsKnockout, setBlockEditsKnockout] = useState<boolean>(false);
  const [savingEditsKnockout, setSavingEditsKnockout] = useState<boolean>(false);

  // Gestión de inscripciones
  interface PendingQuiniela {
    id: string;
    user_id: string;
    username: string;
    status: string;
    championCode: string;
    runnerUpCode: string;
    created_at: string;
    predictions: Record<string, MatchPrediction>;
    knockout_predictions: Record<string, MatchPrediction>;
    groupFilledCount: number;
    knockoutFilledCount: number;
    alias_name?: string;
    has_paid?: boolean;
    allow_edit?: boolean;
  }

  const [pendingQuinielas, setPendingQuinielas] = useState<PendingQuiniela[]>([]);
  const [approvedQuinielas, setApprovedQuinielas] = useState<PendingQuiniela[]>([]);
  const [draftQuinielas, setDraftQuinielas] = useState<PendingQuiniela[]>([]);
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>({});

  // Modal State para ver predicciones del usuario
  const [selectedUser, setSelectedUser] = useState<PendingQuiniela | null>(null);
  const [modalTab, setModalTab] = useState<"groups" | "knockout">("groups");
  const [modalGroupIndex, setModalGroupIndex] = useState(0);

  async function loadQuinielas() {
    const { data, error } = await supabase
      .from("user_quinielas")
      .select(`
        id,
        user_id,
        status,
        predictions,
        knockout_predictions,
        created_at,
        alias_name,
        has_paid,
        allow_edit,
        profiles (username)
      `)
      .order("created_at", { ascending: false });

    if (error || !data) return;

    const mapped = data.map((row: any) => {
      // Calcular campeón/subcampeón
      let championCode = "TBD";
      let runnerUpCode = "TBD";
      try {
        const groupResults = getGroupResults(row.predictions);
        const resolvedKnockout = resolveKnockoutBracket(groupResults, row.knockout_predictions);
        const finalMatch = ALL_KNOCKOUT_MATCHES.find((m) => m.round === "FINAL");
        if (finalMatch) {
          const finalResolved = resolvedKnockout[finalMatch.id];
          const pred = row.knockout_predictions[finalMatch.id];
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
      } catch {}

      const predsMap = row.predictions || {};
      const koMap = row.knockout_predictions || {};
      
      const groupFilledCount = Object.keys(predsMap).filter(
        k => predsMap[k] && predsMap[k].homeGoals !== null && predsMap[k].awayGoals !== null
      ).length;
      
      const knockoutFilledCount = Object.keys(koMap).filter(
        k => koMap[k] && koMap[k].homeGoals !== null && koMap[k].awayGoals !== null
      ).length;

      return {
        id: row.id,
        user_id: row.user_id,
        username: row.profiles?.username || "Usuario",
        status: row.status || "pending",
        championCode,
        runnerUpCode,
        created_at: row.created_at,
        predictions: predsMap,
        knockout_predictions: koMap,
        groupFilledCount,
        knockoutFilledCount,
        alias_name: row.alias_name || "",
        has_paid: !!row.has_paid,
        allow_edit: !!row.allow_edit,
      };
    });

    setPendingQuinielas(mapped.filter((q) => q.status === "pending"));
    setApprovedQuinielas(mapped.filter((q) => q.status === "approved"));
    setDraftQuinielas(mapped.filter((q) => q.status === "draft"));
  }

  // Calcular bracket del usuario seleccionado
  const resolvedUserBracket = useMemo(() => {
    if (!selectedUser) return null;
    const groupResults = getGroupResults(selectedUser.predictions);
    return resolveKnockoutBracket(groupResults, selectedUser.knockout_predictions);
  }, [selectedUser]);

  // Resolver bracket oficial para comparar clasificados y mostrarlos en admin
  const officialBracket = useMemo(() => {
    const officialGroupPreds: Record<string, MatchPrediction> = {};
    const officialKOPreds: Record<string, MatchPrediction> = {};

    CHRONOLOGICAL_MATCHES.forEach((m) => {
      const res = results[m.id];
      if (res && res.homeGoals !== undefined && res.awayGoals !== undefined) {
        officialGroupPreds[m.id] = {
          matchId: m.id,
          homeGoals: res.homeGoals,
          awayGoals: res.awayGoals,
        };
      }
    });

    ALL_KNOCKOUT_MATCHES.forEach((m) => {
      const res = results[m.id];
      if (res && res.homeGoals !== undefined && res.awayGoals !== undefined) {
        officialKOPreds[m.id] = {
          matchId: m.id,
          homeGoals: res.homeGoals,
          awayGoals: res.awayGoals,
        };
      }
    });

    const officialGroupResults = getGroupResults(officialGroupPreds);
    return resolveKnockoutBracket(officialGroupResults, officialKOPreds);
  }, [results]);

  const handleApprove = async (quinielaId: string) => {
    setProcessingIds((prev) => ({ ...prev, [quinielaId]: true }));
    const { error } = await supabase
      .from("user_quinielas")
      .update({ status: "approved" })
      .eq("id", quinielaId);

    if (error) {
      alert("Error al aprobar: " + error.message);
    } else {
      await loadQuinielas();
    }
    setProcessingIds((prev) => ({ ...prev, [quinielaId]: false }));
  };

  const handleReject = async (quinielaId: string) => {
    if (!confirm("¿Seguro que deseas rechazar y ELIMINAR esta quiniela? El usuario tendrá que volver a inscribirse.")) return;

    setProcessingIds((prev) => ({ ...prev, [quinielaId]: true }));
    const { error } = await supabase
      .from("user_quinielas")
      .delete()
      .eq("id", quinielaId);

    if (error) {
      alert("Error al rechazar: " + error.message);
    } else {
      await loadQuinielas();
    }
    setProcessingIds((prev) => ({ ...prev, [quinielaId]: false }));
  };

  const handleUpdateAlias = async (quinielaId: string, value: string) => {
    const { error } = await supabase
      .from("user_quinielas")
      .update({ alias_name: value })
      .eq("id", quinielaId);

    if (error) {
      alert("Error al actualizar identificador: " + error.message);
    } else {
      const updateState = (list: PendingQuiniela[]) =>
        list.map((q) => (q.id === quinielaId ? { ...q, alias_name: value } : q));
      setPendingQuinielas(updateState);
      setApprovedQuinielas(updateState);
      setDraftQuinielas(updateState);
    }
  };

  const handleTogglePaid = async (quinielaId: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    const { error } = await supabase
      .from("user_quinielas")
      .update({ has_paid: newStatus })
      .eq("id", quinielaId);

    if (error) {
      alert("Error al actualizar estado de pago: " + error.message);
    } else {
      const updateState = (list: PendingQuiniela[]) =>
        list.map((q) => (q.id === quinielaId ? { ...q, has_paid: newStatus } : q));
      setPendingQuinielas(updateState);
      setApprovedQuinielas(updateState);
      setDraftQuinielas(updateState);
    }
  };

  const handleToggleAllowEdit = async (quinielaId: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    const { error } = await supabase
      .from("user_quinielas")
      .update({ allow_edit: newStatus })
      .eq("id", quinielaId);

    if (error) {
      alert("Error al actualizar permiso de edición: " + error.message);
    } else {
      const updateState = (list: PendingQuiniela[]) =>
        list.map((q) => (q.id === quinielaId ? { ...q, allow_edit: newStatus } : q));
      setPendingQuinielas(updateState);
      setApprovedQuinielas(updateState);
      setDraftQuinielas(updateState);
    }
  };

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      const username = session?.user?.user_metadata?.username || "";
      if (username.toLowerCase() === "vicdaddy") {
        setIsAdmin(true);
        
        // Cargar visibilidad global de las quinielas
        const { data: settingData } = await supabase
          .from("system_settings")
          .select("value")
          .eq("key", "quinielas_visible")
          .maybeSingle();
        if (settingData && settingData.value) {
          setQuinielasVisible(!!settingData.value.enabled);
        }

        // Cargar bloqueo de inscripciones
        const { data: regSetting } = await supabase
          .from("system_settings")
          .select("value")
          .eq("key", "block_registrations")
          .maybeSingle();
        if (regSetting && regSetting.value) {
          setBlockRegistrations(!!regSetting.value.enabled);
        }

        // Cargar bloqueo de ediciones
        const { data: editSetting } = await supabase
          .from("system_settings")
          .select("value")
          .eq("key", "block_edits")
          .maybeSingle();
        if (editSetting && editSetting.value) {
          setBlockEdits(!!editSetting.value.enabled);
        }

        // Cargar bloqueo de ediciones de eliminatorias
        const { data: editKOSetting } = await supabase
          .from("system_settings")
          .select("value")
          .eq("key", "block_edits_knockout")
          .maybeSingle();
        if (editKOSetting && editKOSetting.value) {
          setBlockEditsKnockout(!!editKOSetting.value.enabled);
        }

        // Cargar resultados oficiales existentes
        const { data } = await supabase.from("official_matches").select("*");
        if (data) {
          const loadedResults: Record<string, { homeGoals: number; awayGoals: number }> = {};
          const loadedSaved: Record<string, boolean> = {};
          data.forEach((row) => {
             loadedResults[row.match_id] = { homeGoals: row.home_goals, awayGoals: row.away_goals };
             loadedSaved[row.match_id] = true;
          });
          setResults(loadedResults);
          setSavedMatches(loadedSaved);
        }
        // Cargar quinielas pendientes y aprobadas
        await loadQuinielas();
      } else {
        setIsAdmin(false);
        window.location.href = "/";
      }
    }
    init();
  }, []);

  const handleToggleVisibility = async () => {
    setSavingVisibility(true);
    const nextVal = !quinielasVisible;
    const { error } = await supabase
      .from("system_settings")
      .upsert({
        key: "quinielas_visible",
        value: { enabled: nextVal },
        updated_at: new Date().toISOString()
      });

    if (error) {
      alert("Error al cambiar visibilidad: " + error.message);
    } else {
      setQuinielasVisible(nextVal);
    }
    setSavingVisibility(false);
  };

  const handleToggleRegistrations = async () => {
    setSavingRegistrations(true);
    const nextVal = !blockRegistrations;
    const { error } = await supabase
      .from("system_settings")
      .upsert({
        key: "block_registrations",
        value: { enabled: nextVal },
        updated_at: new Date().toISOString()
      });

    if (error) {
      alert("Error al cambiar bloqueo de inscripciones: " + error.message);
    } else {
      setBlockRegistrations(nextVal);
    }
    setSavingRegistrations(false);
  };

  const handleToggleEdits = async () => {
    setSavingEdits(true);
    const nextVal = !blockEdits;
    const { error } = await supabase
      .from("system_settings")
      .upsert({
        key: "block_edits",
        value: { enabled: nextVal },
        updated_at: new Date().toISOString()
      });

    if (error) {
      alert("Error al cambiar bloqueo de ediciones: " + error.message);
    } else {
      setBlockEdits(nextVal);
    }
    setSavingEdits(false);
  };

  const handleToggleEditsKnockout = async () => {
    setSavingEditsKnockout(true);
    const nextVal = !blockEditsKnockout;
    const { error } = await supabase
      .from("system_settings")
      .upsert({
        key: "block_edits_knockout",
        value: { enabled: nextVal },
        updated_at: new Date().toISOString()
      });

    if (error) {
      alert("Error al cambiar bloqueo de ediciones de eliminatorias: " + error.message);
    } else {
      setBlockEditsKnockout(nextVal);
    }
    setSavingEditsKnockout(false);
  };

  const handleUpdate = (matchId: string, side: "home" | "away", value: string) => {
    const numVal = value === "" ? null : parseInt(value, 10);
    if (numVal !== null && (isNaN(numVal) || numVal < 0 || numVal > 20)) return;

    setResults((prev) => ({
      ...prev,
      [matchId]: {
        homeGoals: side === "home" ? (numVal ?? 0) : (prev[matchId]?.homeGoals ?? 0),
        awayGoals: side === "away" ? (numVal ?? 0) : (prev[matchId]?.awayGoals ?? 0),
      },
    }));
    setSavedMatches((prev) => ({ ...prev, [matchId]: false }));
  };

  const handleSaveMatch = async (matchId: string) => {
    const matchResult = results[matchId];
    if (!matchResult || matchResult.homeGoals === undefined || matchResult.awayGoals === undefined) {
       return;
    }
    
    setLoadingMatches((prev) => ({ ...prev, [matchId]: true }));
    
    const { error } = await supabase.from("official_matches").upsert({
       match_id: matchId,
       home_goals: matchResult.homeGoals,
       away_goals: matchResult.awayGoals,
       is_completed: true
    });

    setLoadingMatches((prev) => ({ ...prev, [matchId]: false }));
    
    if (!error) {
       setSavedMatches((prev) => ({ ...prev, [matchId]: true }));
    } else {
       alert("Error guardando el partido: " + error.message);
    }
  };

  const handleSimulateRandomResults = async () => {
    const isGroups = resultsTab === "groups";
    const phaseName = isGroups ? "Fase de Grupos" : "Eliminatorias";
    
    if (!confirm(`¿Seguro que deseas simular y guardar marcadores aleatorios para la ${phaseName}? Esto actualizará la base de datos y afectará a todas las quinielas.`)) {
      return;
    }

    try {
      setIsSaving(true);
      const rows: any[] = [];
      const updatedResults: Record<string, { homeGoals: number; awayGoals: number }> = { ...results };
      const updatedSaved: Record<string, boolean> = { ...savedMatches };

      if (isGroups) {
        CHRONOLOGICAL_MATCHES.forEach((m) => {
          const home = Math.floor(Math.random() * 4);
          const away = Math.floor(Math.random() * 4);
          rows.push({
            match_id: m.id,
            home_goals: home,
            away_goals: away,
            is_completed: true
          });
          updatedResults[m.id] = { homeGoals: home, awayGoals: away };
          updatedSaved[m.id] = true;
        });
      } else {
        // Para las eliminatorias, necesitamos asegurar que no haya empates
        ALL_KNOCKOUT_MATCHES.forEach((m) => {
          let home = Math.floor(Math.random() * 4);
          let away = Math.floor(Math.random() * 4);
          while (home === away) {
            home = Math.floor(Math.random() * 5);
            away = Math.floor(Math.random() * 5);
          }
          rows.push({
            match_id: m.id,
            home_goals: home,
            away_goals: away,
            is_completed: true
          });
          updatedResults[m.id] = { homeGoals: home, awayGoals: away };
          updatedSaved[m.id] = true;
        });
      }

      // Upsert a Supabase en bloque
      const { error } = await supabase
        .from("official_matches")
        .upsert(rows);

      if (error) {
        alert("Error al guardar marcadores simulados: " + error.message);
      } else {
        setResults(updatedResults);
        setSavedMatches(updatedSaved);
        alert(`🎉 ¡Marcadores para la ${phaseName} simulados e insertados con éxito!`);
        // Recargar quinielas para actualizar puntajes en la vista del admin
        await loadQuinielas();
      }
    } catch (err) {
      console.error(err);
      alert("Ocurrió un error al simular resultados.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearOfficialResults = async () => {
    const isGroups = resultsTab === "groups";
    const phaseName = isGroups ? "Fase de Grupos" : "Eliminatorias";
    
    if (!confirm(`¿Seguro que deseas BORRAR todos los resultados oficiales de la ${phaseName} de la base de datos?`)) {
      return;
    }

    try {
      setIsSaving(true);
      const matchIds = isGroups 
        ? CHRONOLOGICAL_MATCHES.map((m) => m.id)
        : ALL_KNOCKOUT_MATCHES.map((m) => m.id);

      const { error } = await supabase
        .from("official_matches")
        .delete()
        .in("match_id", matchIds);

      if (error) {
        alert("Error al borrar resultados: " + error.message);
      } else {
        // Limpiar del estado local
        const updatedResults = { ...results };
        const updatedSaved = { ...savedMatches };
        matchIds.forEach((id) => {
          delete updatedResults[id];
          delete updatedSaved[id];
        });
        setResults(updatedResults);
        setSavedMatches(updatedSaved);
        alert(`🧹 ¡Resultados de la ${phaseName} eliminados con éxito!`);
        await loadQuinielas();
      }
    } catch (err) {
      console.error(err);
      alert("Ocurrió un error al limpiar resultados.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isAdmin === null) {
    return <div className="p-12 text-center font-bold text-content-muted">Verificando credenciales seguras...</div>;
  }
  if (isAdmin === false) return null; // Redirigiendo

  return (
    <div className="max-w-4xl mx-auto pb-12 animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="text-red-500" size={32} />
          <h1 className="text-3xl font-extrabold text-content tracking-tight">Panel de Administrador</h1>
        </div>
        <p className="text-content-muted">
          Plataforma exclusiva para <span className="font-bold text-content">VicDaddy</span>.
        </p>
      </div>

      {/* Ajustes Globales del Torneo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        
        {/* Visibilidad Pública */}
        <div className="glass-panel p-5 flex flex-col justify-between gap-4 border border-line rounded-2xl bg-panel/30">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${quinielasVisible ? 'bg-brand/10 text-brand border border-brand/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
              {quinielasVisible ? <Eye size={20} /> : <EyeOff size={20} />}
            </div>
            <div>
              <h3 className="font-bold text-content text-sm">Visibilidad Torneo</h3>
              <p className="text-xs text-content-muted mt-1 leading-relaxed">
                {quinielasVisible 
                  ? "Las quinielas y el ranking son visibles para todos." 
                  : "Las quinielas y el ranking están ocultos para usuarios normales."}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleVisibility}
            disabled={savingVisibility}
            className={`w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              quinielasVisible 
                ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20' 
                : 'bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20'
            }`}
          >
            {savingVisibility ? "Guardando..." : quinielasVisible ? "Ocultar Rankings" : "Hacer Públicos"}
          </button>
        </div>

        {/* Bloqueo de Inscripciones */}
        <div className="glass-panel p-5 flex flex-col justify-between gap-4 border border-line rounded-2xl bg-panel/30">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${!blockRegistrations ? 'bg-brand/10 text-brand border border-brand/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
              {!blockRegistrations ? <UserCheck size={20} /> : <UserX size={20} />}
            </div>
            <div>
              <h3 className="font-bold text-content text-sm">Inscripciones</h3>
              <p className="text-xs text-content-muted mt-1 leading-relaxed">
                {!blockRegistrations 
                  ? "Se aceptan nuevas quinielas e inscripciones." 
                  : "Las inscripciones están cerradas. No se permiten nuevos usuarios."}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleRegistrations}
            disabled={savingRegistrations}
            className={`w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              !blockRegistrations 
                ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20' 
                : 'bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20'
            }`}
          >
            {savingRegistrations ? "Guardando..." : !blockRegistrations ? "Cerrar Inscripciones" : "Abrir Inscripciones"}
          </button>
        </div>

        {/* Bloqueo de Ediciones - Grupos */}
        <div className="glass-panel p-5 flex flex-col justify-between gap-4 border border-line rounded-2xl bg-panel/30">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${!blockEdits ? 'bg-brand/10 text-brand border border-brand/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
              {!blockEdits ? <Clock size={20} /> : <Lock size={20} />}
            </div>
            <div>
              <h3 className="font-bold text-content text-sm">Edición Grupos</h3>
              <p className="text-xs text-content-muted mt-1 leading-relaxed">
                {!blockEdits 
                  ? "Se permite la edición de pronósticos de fase de grupos." 
                  : "Fase de grupos bloqueada para edición."}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleEdits}
            disabled={savingEdits}
            className={`w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              !blockEdits 
                ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20' 
                : 'bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20'
            }`}
          >
            {savingEdits ? "Guardando..." : !blockEdits ? "Bloquear Grupos" : "Permitir Grupos"}
          </button>
        </div>

        {/* Bloqueo de Ediciones - Eliminatorias */}
        <div className="glass-panel p-5 flex flex-col justify-between gap-4 border border-line rounded-2xl bg-panel/30">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${!blockEditsKnockout ? 'bg-brand/10 text-brand border border-brand/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
              {!blockEditsKnockout ? <Clock size={20} /> : <Lock size={20} />}
            </div>
            <div>
              <h3 className="font-bold text-content text-sm">Edición Eliminatorias</h3>
              <p className="text-xs text-content-muted mt-1 leading-relaxed">
                {!blockEditsKnockout 
                  ? "Se permite la edición del cuadro de eliminatorias." 
                  : "Eliminatorias bloqueadas para edición."}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleEditsKnockout}
            disabled={savingEditsKnockout}
            className={`w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              !blockEditsKnockout 
                ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20' 
                : 'bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20'
            }`}
          >
            {savingEditsKnockout ? "Guardando..." : !blockEditsKnockout ? "Bloquear Eliminat." : "Permitir Eliminat."}
          </button>
        </div>

      </div>

      {/* Admin Tabs */}
      <div className="flex items-center gap-2 border-b border-line mb-8 pb-4">
        <button
          onClick={() => setAdminTab("inscripciones")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            adminTab === "inscripciones"
              ? "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)]"
              : "text-content-muted hover:bg-panel hover:text-content"
          }`}
        >
          <UserCheck size={18} /> Gestión de Inscripciones
          {pendingQuinielas.length > 0 && (
            <span className="bg-yellow-500 text-black text-xs font-bold px-2 py-0.5 rounded-full ml-1">
              {pendingQuinielas.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setAdminTab("resultados")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            adminTab === "resultados"
              ? "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)]"
              : "text-content-muted hover:bg-panel hover:text-content"
          }`}
        >
          <Save size={18} /> Cargar Resultados
        </button>
      </div>

      {/* ======================================================
          TAB 1: GESTIÓN DE INSCRIPCIONES
      ====================================================== */}
      {adminTab === "inscripciones" && (
        <div className="space-y-8">
          {/* QUINIELAS PENDIENTES */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 border-b border-line pb-4 mb-6">
              <Clock size={22} className="text-yellow-500" />
              <h2 className="text-xl font-bold text-content">Quinielas Pendientes de Aprobación</h2>
              <span className="text-sm font-bold bg-yellow-500/20 text-yellow-500 px-3 py-1 rounded-full ml-auto">
                {pendingQuinielas.length} pendientes
              </span>
            </div>

            {pendingQuinielas.length === 0 ? (
              <div className="text-center py-10">
                <CheckCircle2 size={40} className="text-brand/40 mx-auto mb-3" />
                <p className="text-content-muted font-medium">No hay quinielas pendientes de aprobación</p>
                <p className="text-content-muted text-xs mt-1">Todas las inscripciones han sido procesadas.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingQuinielas.map((q) => {
                  const champion = q.championCode !== "TBD" ? TEAMS[q.championCode] : null;
                  const runnerUp = q.runnerUpCode !== "TBD" ? TEAMS[q.runnerUpCode] : null;
                  const isProcessing = processingIds[q.id];
                  const date = new Date(q.created_at).toLocaleDateString("es-MX", {
                    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
                  });

                  return (
                    <div key={q.id} className="bg-card border-2 border-yellow-500/30 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center border border-yellow-500/50 shrink-0">
                          <span className="text-yellow-500 font-bold text-lg">
                            {q.username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                            <h3 className="font-bold text-content text-lg truncate">{q.username}</h3>
                            {q.alias_name && (
                              <span className="text-xs bg-brand/10 border border-brand/20 px-2.5 py-0.5 rounded text-brand font-bold max-w-[200px] truncate" title={q.alias_name}>
                                {q.alias_name}
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setSelectedUser(q);
                                setModalTab("groups");
                                setModalGroupIndex(0);
                              }}
                              className="p-1 hover:bg-panel rounded text-content-muted hover:text-brand transition-colors self-start sm:self-auto"
                              title="Ver Predicciones"
                            >
                              <Eye size={16} />
                            </button>
                          </div>
                          <p className="text-xs text-content-muted">Registrada: {date}</p>
                          <div className="mt-2 flex items-center gap-2 max-w-[280px]">
                            <span className="text-[10px] text-content-muted shrink-0 font-bold uppercase tracking-wider">Alias:</span>
                            <input
                              type="text"
                              defaultValue={q.alias_name || ""}
                              placeholder="Asignar nombre/alias..."
                              onBlur={(e) => {
                                if (e.target.value !== (q.alias_name || "")) {
                                  handleUpdateAlias(q.id, e.target.value);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.currentTarget.blur();
                                }
                              }}
                              className="bg-base border border-line text-content text-xs rounded px-2 py-0.5 outline-none focus:border-brand/50 flex-1 transition-all"
                            />
                          </div>
                          <div className="flex items-center gap-3 mt-2">
                            {champion && (
                              <span className="flex items-center gap-1 text-xs text-content-muted">
                                <span className="text-content-muted">🏆</span>
                                <Flag iso2={champion.iso2} name={champion.name} size="sm" />
                                {champion.name}
                              </span>
                            )}
                            {runnerUp && (
                              <span className="flex items-center gap-1 text-xs text-content-muted">
                                <span>🥈</span>
                                <Flag iso2={runnerUp.iso2} name={runnerUp.name} size="sm" />
                                {runnerUp.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 sm:gap-3 w-full md:w-auto mt-2 md:mt-0 justify-end flex-wrap">
                        <button
                          onClick={() => handleToggleAllowEdit(q.id, !!q.allow_edit)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg border font-bold text-xs transition-all cursor-pointer shrink-0 ${
                            q.allow_edit
                              ? "bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 border-purple-500/35 shadow-[0_0_8px_rgba(168,85,247,0.15)]"
                              : "bg-panel hover:bg-card text-content-muted border-line"
                          }`}
                          title={q.allow_edit ? "Deshabilitar Edición Excepcional" : "Habilitar Edición Excepcional"}
                        >
                          <span>{q.allow_edit ? "🔓" : "🔒"}<span className="hidden md:inline"> {q.allow_edit ? "Edición Habilitada" : "Habilitar Edición"}</span></span>
                        </button>
                        <button
                          onClick={() => handleTogglePaid(q.id, !!q.has_paid)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 md:px-3.5 md:py-2 rounded-lg border font-bold text-xs transition-all cursor-pointer shrink-0 ${
                            q.has_paid
                              ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border-emerald-500/35"
                              : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/25"
                          }`}
                          title={q.has_paid ? "Marcar como No Pagado" : "Marcar como Pagado"}
                        >
                          <span>💰<span className="hidden md:inline"> {q.has_paid ? "Pagado" : "Pendiente"}</span></span>
                        </button>
                        <button
                          onClick={() => handleApprove(q.id)}
                          disabled={isProcessing}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 md:px-5 md:py-2 rounded-lg font-bold text-xs md:text-sm bg-brand hover:bg-brand-hover text-white transition-colors disabled:opacity-50"
                        >
                          {isProcessing ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <><UserCheck size={16} /><span className="hidden md:inline"> Aprobar</span></>
                          )}
                        </button>
                        <button
                          onClick={() => handleReject(q.id)}
                          disabled={isProcessing}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 md:px-5 md:py-2 rounded-lg font-bold text-xs md:text-sm bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 transition-colors disabled:opacity-50"
                        >
                          <UserX size={16} /><span className="hidden md:inline"> Rechazar</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* QUINIELAS APROBADAS */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 border-b border-line pb-4 mb-6">
              <CheckCircle2 size={22} className="text-brand" />
              <h2 className="text-xl font-bold text-content">Quinielas Aprobadas</h2>
              <span className="text-sm font-bold bg-brand/20 text-brand px-3 py-1 rounded-full ml-auto">
                {approvedQuinielas.length} aprobadas
              </span>
            </div>

            {approvedQuinielas.length === 0 ? (
              <p className="text-center text-content-muted py-8">No hay quinielas aprobadas todavía.</p>
            ) : (
              <div className="space-y-3">
                {approvedQuinielas.map((q) => {
                  const champion = q.championCode !== "TBD" ? TEAMS[q.championCode] : null;
                  const isProcessing = processingIds[q.id];

                  return (
                    <div key={q.id} className="bg-card border border-line rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-full bg-brand/20 flex items-center justify-center border border-brand/50 shrink-0">
                          <span className="text-brand font-bold text-sm">
                            {q.username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-content truncate">{q.username}</h3>
                            {q.alias_name && (
                              <span className="text-[10px] bg-brand/10 border border-brand/20 px-2 py-0.5 rounded text-brand font-bold max-w-[150px] truncate" title={q.alias_name}>
                                {q.alias_name}
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setSelectedUser(q);
                                setModalTab("groups");
                                setModalGroupIndex(0);
                              }}
                              className="p-1 hover:bg-panel rounded text-content-muted hover:text-brand transition-colors"
                              title="Ver Predicciones"
                            >
                              <Eye size={14} />
                            </button>
                          </div>
                          <div className="mt-1 flex items-center gap-2 max-w-[250px]">
                            <span className="text-[9px] text-content-muted shrink-0 font-bold uppercase tracking-wider">Alias:</span>
                            <input
                              type="text"
                              defaultValue={q.alias_name || ""}
                              placeholder="Asignar nombre/alias..."
                              onBlur={(e) => {
                                if (e.target.value !== (q.alias_name || "")) {
                                  handleUpdateAlias(q.id, e.target.value);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.currentTarget.blur();
                                }
                              }}
                              className="bg-base border border-line text-content text-[11px] rounded px-2 py-0.5 outline-none focus:border-brand/50 flex-1 transition-all"
                            />
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            {champion && (
                              <span className="flex items-center gap-1 text-xs text-content-muted">
                                🏆
                                <Flag iso2={champion.iso2} name={champion.name} size="sm" />
                                {champion.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto flex-wrap justify-end">
                        <button
                          onClick={() => handleToggleAllowEdit(q.id, !!q.allow_edit)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-bold text-xs transition-all cursor-pointer shrink-0 ${
                            q.allow_edit
                              ? "bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 border-purple-500/35 shadow-[0_0_8px_rgba(168,85,247,0.15)]"
                              : "bg-panel hover:bg-card text-content-muted border-line"
                          }`}
                          title={q.allow_edit ? "Deshabilitar Edición Excepcional" : "Habilitar Edición Excepcional"}
                        >
                          <span>{q.allow_edit ? "🔓" : "🔒"}<span className="hidden md:inline"> {q.allow_edit ? "Edición Habilitada" : "Habilitar Edición"}</span></span>
                        </button>
                        <button
                          onClick={() => handleTogglePaid(q.id, !!q.has_paid)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold text-xs transition-all cursor-pointer ${
                            q.has_paid
                              ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border-emerald-500/35"
                              : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/25"
                          }`}
                          title={q.has_paid ? "Marcar como No Pagado" : "Marcar como Pagado"}
                        >
                          <span>💰<span className="hidden md:inline"> {q.has_paid ? "Pagado" : "Pendiente"}</span></span>
                        </button>
                        <span className="text-xs font-bold bg-brand/10 text-brand px-3 py-1 rounded-full hidden sm:inline">
                          ✓ Aprobada
                        </span>
                        <button
                          onClick={() => handleReject(q.id)}
                          disabled={isProcessing}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 transition-colors disabled:opacity-50"
                          title="Eliminar Quiniela"
                        >
                          <UserX size={14} /><span className="hidden md:inline"> Eliminar</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* BORRADORES / QUINIELAS INCOMPLETAS */}
          <div className="glass-panel p-6">
            <div className="flex items-center gap-3 border-b border-line pb-4 mb-6">
              <Clock size={22} className="text-yellow-500/80" />
              <h2 className="text-xl font-bold text-content">Borradores / Quinielas Incompletas</h2>
              <span className="text-sm font-bold bg-yellow-500/10 text-yellow-500 px-3 py-1 rounded-full ml-auto">
                {draftQuinielas.length} borradores
              </span>
            </div>

            {draftQuinielas.length === 0 ? (
              <p className="text-center text-content-muted py-8">No hay borradores ni quinielas incompletas.</p>
            ) : (
              <div className="space-y-3">
                {draftQuinielas.map((q) => {
                  const isProcessing = processingIds[q.id];

                  return (
                    <div key={q.id} className="bg-card border border-line/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-full bg-yellow-500/10 flex items-center justify-center border border-yellow-500/20 shrink-0">
                          <span className="text-yellow-500 font-bold text-sm">
                            {q.username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-content truncate">{q.username}</h3>
                            {q.alias_name && (
                              <span className="text-[10px] bg-brand/10 border border-brand/20 px-2 py-0.5 rounded text-brand font-bold max-w-[150px] truncate" title={q.alias_name}>
                                {q.alias_name}
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setSelectedUser(q);
                                setModalTab("groups");
                                setModalGroupIndex(0);
                              }}
                              className="p-1 hover:bg-panel rounded text-content-muted hover:text-brand transition-colors"
                              title="Ver Predicciones"
                            >
                              <Eye size={14} />
                            </button>
                          </div>
                          <div className="mt-1 flex items-center gap-2 max-w-[250px]">
                            <span className="text-[9px] text-content-muted shrink-0 font-bold uppercase tracking-wider">Alias:</span>
                            <input
                              type="text"
                              defaultValue={q.alias_name || ""}
                              placeholder="Asignar nombre/alias..."
                              onBlur={(e) => {
                                if (e.target.value !== (q.alias_name || "")) {
                                  handleUpdateAlias(q.id, e.target.value);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.currentTarget.blur();
                                }
                              }}
                              className="bg-base border border-line text-content text-[11px] rounded px-2 py-0.5 outline-none focus:border-brand/50 flex-1 transition-all"
                            />
                          </div>
                          <p className="text-xs text-content-muted mt-1.5">
                            Grupos: <span className="font-bold text-content">{q.groupFilledCount}/72</span> | 
                            Eliminatorias: <span className="font-bold text-content">{q.knockoutFilledCount}/32</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto flex-wrap justify-end">
                        <button
                          onClick={() => handleToggleAllowEdit(q.id, !!q.allow_edit)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-bold text-xs transition-all cursor-pointer shrink-0 ${
                            q.allow_edit
                              ? "bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 border-purple-500/35 shadow-[0_0_8px_rgba(168,85,247,0.15)]"
                              : "bg-panel hover:bg-card text-content-muted border-line"
                          }`}
                          title={q.allow_edit ? "Deshabilitar Edición Excepcional" : "Habilitar Edición Excepcional"}
                        >
                          <span>{q.allow_edit ? "🔓" : "🔒"}<span className="hidden md:inline"> {q.allow_edit ? "Edición Habilitada" : "Habilitar Edición"}</span></span>
                        </button>
                        <button
                          onClick={() => handleTogglePaid(q.id, !!q.has_paid)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold text-xs transition-all cursor-pointer ${
                            q.has_paid
                              ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border-emerald-500/35"
                              : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/25"
                          }`}
                          title={q.has_paid ? "Marcar como No Pagado" : "Marcar como Pagado"}
                        >
                          <span>💰<span className="hidden md:inline"> {q.has_paid ? "Pagado" : "Pendiente"}</span></span>
                        </button>
                        <span className="text-xs font-bold bg-yellow-500/10 text-yellow-500 px-3 py-1 rounded-full hidden sm:inline">
                          Borrador
                        </span>
                        <button
                          onClick={() => handleApprove(q.id)}
                          disabled={isProcessing}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs bg-brand hover:bg-brand-hover text-white transition-colors disabled:opacity-50"
                          title="Aprobar Borrador"
                        >
                          {isProcessing ? (
                            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <><UserCheck size={14} /><span className="hidden md:inline"> Aprobar</span></>
                          )}
                        </button>
                        <button
                          onClick={() => handleReject(q.id)}
                          disabled={isProcessing}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 transition-colors disabled:opacity-50"
                          title="Eliminar Borrador"
                        >
                          <UserX size={14} /><span className="hidden md:inline"> Eliminar</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================
          TAB 2: CARGA DE RESULTADOS OFICIALES
      ====================================================== */}
      {adminTab === "resultados" && (
        <>
          {/* Warning Banner */}
          <div className="flex items-start gap-4 bg-red-500/10 border border-red-500/30 text-red-500 px-6 py-4 rounded-xl mb-8">
            <AlertTriangle size={24} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-lg mb-1">Carga de Resultados Oficiales</p>
              <p className="text-sm opacity-90">
                Los marcadores ingresados en esta sección afectarán directamente el ranking global de todos los usuarios.
                Asegúrate de que los partidos hayan finalizado antes de registrar el marcador.
              </p>
            </div>
          </div>

          {/* Sub-tabs for Results Filtering */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setResultsTab("groups")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border ${
                resultsTab === "groups"
                  ? "bg-brand text-white border-brand shadow-[0_0_12px_rgba(0,176,107,0.25)]"
                  : "bg-panel text-content-muted border-line hover:text-content"
              }`}
            >
              Fase de Grupos (72 partidos)
            </button>
            <button
              onClick={() => setResultsTab("knockout")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border ${
                resultsTab === "knockout"
                  ? "bg-brand text-white border-brand shadow-[0_0_12px_rgba(0,176,107,0.25)]"
                  : "bg-panel text-content-muted border-line hover:text-content"
              }`}
            >
              Fase de Eliminatorias (32 partidos)
            </button>
          </div>

          {/* Match List */}
          <div className="glass-panel p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-line pb-4 gap-3">
              <h2 className="text-xl font-bold text-content">
                {resultsTab === "groups" ? "Partidos de Grupo Oficiales" : "Partidos de Eliminatorias Oficiales"}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSimulateRandomResults}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-brand/10 hover:bg-brand/20 border border-brand/20 rounded-lg text-xs font-bold text-brand transition-all active:scale-95 shrink-0"
                >
                  <Dices size={14} />
                  Simular al Azar
                </button>
                <button
                  type="button"
                  onClick={handleClearOfficialResults}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs font-bold text-red-500 transition-all active:scale-95 shrink-0"
                >
                  <Trash2 size={14} />
                  Limpiar Todo
                </button>
                <span className="text-xs text-content-muted font-medium ml-2 hidden md:inline">
                  Guarda uno por uno
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {(() => {
                const matchesToRender = resultsTab === "groups" ? CHRONOLOGICAL_MATCHES : CHRONOLOGICAL_KNOCKOUT_MATCHES;
                return matchesToRender.map((match) => {
                  const isKnockout = match.id.startsWith("M");
                  const homeCode = isKnockout ? officialBracket[match.id]?.home : (match as any).homeTeam;
                  const awayCode = isKnockout ? officialBracket[match.id]?.away : (match as any).awayTeam;

                  const home = homeCode ? TEAMS[homeCode] : null;
                  const away = awayCode ? TEAMS[awayCode] : null;
                  const hasBothTeams = !!home && !!away;

                  const prediction = results[match.id];
                  const isSaved = savedMatches[match.id];
                  const isLoading = loadingMatches[match.id];

                  return (
                    <div key={match.id} className="bg-card border border-line rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in duration-200">
                      
                      {/* Left: Info (with Schedule for Mobile) */}
                      <div className="flex items-center justify-between w-full md:w-28 md:flex-col md:items-start md:justify-center shrink-0 border-b border-line/45 md:border-b-0 pb-2 md:pb-0 mb-1 md:mb-0">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-brand">{match.id}</span>
                          <span className="text-[10px] text-content-muted font-semibold mt-0.5">
                            {isKnockout ? ROUND_DESCRIPTIONS[(match as any).round] : `Grupo ${(match as any).group}`}
                          </span>
                        </div>
                        {MATCH_SCHEDULES[match.id] && (
                          <span className="text-[9px] text-content-muted font-semibold bg-panel px-2 py-0.5 rounded border border-line/35 md:hidden">
                            {MATCH_SCHEDULES[match.id].date} @ {MATCH_SCHEDULES[match.id].time}
                          </span>
                        )}
                      </div>
                      
                      {/* Center: Teams & Score Inputs */}
                      <div className="flex items-center justify-between w-full md:w-auto flex-1 gap-1.5 sm:gap-4 py-1">
                        
                        {/* Home Team */}
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-1 justify-end min-w-0">
                          {home ? (
                            <>
                              <span className="font-semibold text-content text-xs sm:text-sm text-right truncate">
                                {home.name}
                              </span>
                              <Flag iso2={home.iso2} name={home.name} size="md" />
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-content-muted">Por definir</span>
                              <span className="w-6 h-4 bg-line/30 rounded shrink-0"></span>
                            </>
                          )}
                        </div>

                        {/* Score Inputs */}
                        <div className="flex items-center gap-1.5 shrink-0 px-1">
                          <input
                            type="number"
                            disabled={!hasBothTeams}
                            value={prediction?.homeGoals ?? ""}
                            onChange={(e) => handleUpdate(match.id, "home", e.target.value)}
                            placeholder="-"
                            className="w-10 h-10 bg-base border border-line rounded-lg text-center text-lg font-bold text-content focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none transition-all appearance-none disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                          <span className="text-content-muted font-bold">:</span>
                          <input
                            type="number"
                            disabled={!hasBothTeams}
                            value={prediction?.awayGoals ?? ""}
                            onChange={(e) => handleUpdate(match.id, "away", e.target.value)}
                            placeholder="-"
                            className="w-10 h-10 bg-base border border-line rounded-lg text-center text-lg font-bold text-content focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none transition-all appearance-none disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </div>

                        {/* Away Team */}
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
                          {away ? (
                            <>
                              <Flag iso2={away.iso2} name={away.name} size="md" />
                              <span className="font-semibold text-content text-xs sm:text-sm truncate">
                                {away.name}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="w-6 h-4 bg-line/30 rounded shrink-0"></span>
                              <span className="text-xs text-content-muted font-medium">Por definir</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right-Center: Date & Time Schedule (Desktop only) */}
                      {MATCH_SCHEDULES[match.id] && (
                        <div className="hidden md:flex flex-col text-right w-24 shrink-0 pr-1">
                          <span className="text-[9px] text-content font-bold uppercase tracking-wider">Horario</span>
                          <span className="text-[10px] text-content-muted mt-0.5 truncate">{MATCH_SCHEDULES[match.id].date.split(" de ")[0]}</span>
                          <span className="text-[9px] text-brand font-semibold mt-0.5">{MATCH_SCHEDULES[match.id].time} hs</span>
                        </div>
                      )}

                      {/* Save Button for this specific match */}
                      <button
                        onClick={() => handleSaveMatch(match.id)}
                        disabled={isLoading || !hasBothTeams || prediction?.homeGoals === undefined || prediction?.awayGoals === undefined}
                        className={`shrink-0 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-colors w-full md:w-32 ${
                          isSaved 
                            ? "bg-brand/10 text-brand border border-brand/30" 
                            : "bg-red-500 hover:bg-red-600 text-white disabled:opacity-50 disabled:bg-panel disabled:text-content-muted disabled:border disabled:border-line"
                        }`}
                      >
                        {isLoading ? (
                          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                        ) : isSaved ? (
                          <>Guardado ✓</>
                        ) : (
                          <>
                            <Save size={16} /> Guardar
                          </>
                        )}
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </>
      )}

      {/* =========================================
          MODAL: DETALLE DE QUINIELA DEL USUARIO (VISTA READ-ONLY PARA EL ADMIN)
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
                  <p className="text-sm text-brand font-medium">Torneo Mundial 2026 ({selectedUser.status === 'draft' ? 'Borrador' : 'Inscripción'})</p>
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
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar font-sans">
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
                    const official = results[match.id];
                    if (pred && official && pred.homeGoals !== null && pred.awayGoals !== null) {
                      groupMatchPoints += calculateMatchPoints(
                        pred.homeGoals,
                        pred.awayGoals,
                        official.homeGoals,
                        official.awayGoals
                      );
                      groupMatchesCount++;
                    }
                  });

                  let groupPosPoints = 0;
                  const isGroupCompleted = groupMatches.every((m) => results[m.id] !== undefined);
                  if (isGroupCompleted) {
                    const userGroupResults = getGroupResults(selectedUser.predictions);
                    const officialGroupPreds: Record<string, MatchPrediction> = {};
                    Object.entries(results).forEach(([id, om]) => {
                      officialGroupPreds[id] = { matchId: id, homeGoals: om.homeGoals, awayGoals: om.awayGoals };
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
                          {results && Object.keys(results).length > 0 && (
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
                                  const official = results[match.id];
                                  
                                  const scoring = (pred && official && pred.homeGoals !== null && pred.awayGoals !== null)
                                    ? getDetailedMatchScoring(pred.homeGoals, pred.awayGoals, official.homeGoals, official.awayGoals)
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
                                      className={`bg-card border rounded-xl p-3 sm:p-4 shadow-sm transition-colors ${
                                        scoring
                                          ? scoring.isExactScore ? "border-emerald-500/40" : scoring.points > 0 ? "border-line" : "border-red-500/20"
                                          : "border-line hover:border-line-hover"
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
                                              {official.homeGoals} - {official.awayGoals}
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
                        <GroupStandings standings={standings} groupName={groupKey} officialMatchesMap={results} />
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
                    predictions={selectedUser.knockout_predictions}
                    readOnly={true}
                    officialMatchesMap={results}
                    officialResolved={officialBracket}
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
