/**
 * Documentation fonctionnelle de l'application QA Platform.
 *
 * Source unique de vérité pour le fichier de rétro-spécifications téléchargeable.
 * Maintenir à jour manuellement lors des évolutions métier.
 *
 * Format JSON structuré pour être lisible par d'autres outils / scripts.
 */

export const APP_SPECS = {
  metadata: {
    name: "QA Platform",
    description:
      "Plateforme de gestion de projet et de QA avec workflow d'estimation, Kanban, pilotage temps et Test Runner.",
    version: "retrospec-1",
    generatedBy: "lib/specs/app-specs.ts",
    downloadableBy: ["ADMIN", "PRODUCT_OWNER", "TESTER"],
  },

  roles: {
    ADMIN: {
      label: "Administrateur",
      permissions: [
        "Toutes les actions sur tous les projets",
        "Gestion des jours fériés globaux",
        "Gestion des congés de tous les utilisateurs",
        "Suppression de tickets (avec garde-fous)",
        "Accès à toutes les pages de pilotage",
      ],
    },
    PRODUCT_OWNER: {
      label: "Product Owner / Cheffe de projet",
      permissions: [
        "Création et édition des Epics et Features",
        "Estimation initiale manuelle d'une Feature",
        "Gestion des jours fériés globaux",
        "Gestion des congés de l'équipe",
        "Vue Pilotage (dashboards de dérive, coût, projection)",
        "Suppression de tickets",
      ],
    },
    DEVELOPER: {
      label: "Développeur",
      permissions: [
        "Kanban filtré : voit uniquement Tasks + Bugs (ses Tasks + celles du projet)",
        "Création de User Stories et Tasks (chiffrées ou TODO)",
        "Lancement de sessions d'estimation sur des Features",
        "Log de temps sur ses Tasks (sauf TODO)",
        "Modification du reste à faire de ses Tasks",
        "Consultation des Features parentes pour relire les specs",
      ],
    },
    TESTER: {
      label: "Testeur",
      permissions: [
        "Lancement du Test Runner sur les User Stories / Features",
        "Création de cas de test",
        "Enregistrement des résultats OK/KO",
        "Création automatique de Bugs au KO",
      ],
    },
  },

  ticketTypes: {
    EPIC: {
      label: "Epic",
      description:
        "Regroupement de haut niveau servant UNIQUEMENT à trier la spécification fonctionnelle.",
      hasEstimation: false,
      hasRemaining: false,
      hasLog: false,
      canBeParentOf: ["FEATURE"],
      canBeChildOf: [],
    },
    FEATURE: {
      label: "Feature",
      description:
        "Unité fonctionnelle chiffrable. Peut être estimée manuellement par le PO ou décomposée en Tasks via session d'estimation.",
      hasEstimation: true,
      hasRemaining: true,
      hasLog: false, // le log se fait sur les enfants
      canBeParentOf: ["TASK", "USER_STORY", "BUG"],
      canBeChildOf: ["EPIC"],
      specialRules: [
        "L'estimation est hybride tant qu'aucun log n'existe : estim propre + somme estimations Tasks chiffrées enfants.",
        "Au premier log dans le sous-arbre, l'estimation est gelée (snapshot + horodatage frozenAt).",
        "Après le gel : toute nouvelle Task ajoutée augmente le RAF mais pas l'estimation initiale, rendant les dépassements visibles.",
      ],
    },
    USER_STORY: {
      label: "User Story",
      description: "Legacy, conservée pour compatibilité. Peut contenir des Tasks et Bugs.",
      hasEstimation: true,
      hasRemaining: true,
      hasLog: true,
      canBeParentOf: ["TASK", "BUG"],
      canBeChildOf: ["FEATURE"],
    },
    TASK: {
      label: "Tâche",
      description:
        "Unité d'exécution pour les développeurs. Peut être chiffrée (compte dans l'agrégation Feature) ou TODO (hors estimation).",
      hasEstimation: true,
      hasRemaining: true,
      hasLog: true,
      canBeParentOf: [],
      canBeChildOf: ["FEATURE", "USER_STORY"],
      variants: {
        CHIFFREE: "isEstimated=true — compte dans les totaux parents",
        TODO: "isEstimated=false — ignorée des sommes, log de temps bloqué",
      },
    },
    BUG: {
      label: "Bug",
      description:
        "Anomalie remontée manuellement ou générée automatiquement par le Test Runner au KO d'un cas de test.",
      hasEstimation: true,
      hasRemaining: true,
      hasLog: true,
      canBeParentOf: [],
      canBeChildOf: ["FEATURE", "USER_STORY"],
    },
  },

  statuses: [
    { key: "BACKLOG", label: "Backlog" },
    { key: "TODO", label: "À faire" },
    { key: "IN_PROGRESS", label: "En cours" },
    { key: "IN_REVIEW", label: "Revue" },
    { key: "IN_TESTING", label: "Test" },
    { key: "DONE", label: "Terminé", sideEffect: "RAF forcé à 0 et verrouillé" },
    { key: "BLOCKED", label: "Bloqué", trigger: "Auto-déclenché sur KO de Test Runner" },
  ],

  workflows: {
    estimationSession: {
      name: "Session d'estimation d'une Feature",
      steps: [
        "Un PO ou Admin crée une Feature (elle apparaît avec un badge 'À estimer')",
        "N'importe quel rôle peut cliquer 'Estimer' sur la Feature pour ouvrir une session",
        "Dans la session, on crée N Tasks avec titre + estimation en jours + description optionnelle",
        "Au clic 'Terminer la session', toutes les Tasks sont créées en une transaction atomique",
        "Le badge 'À estimer' disparaît automatiquement (Feature a maintenant des enfants)",
      ],
      accessibleBy: "Tout rôle connecté",
    },
    estimationLock: {
      name: "Verrouillage de l'estimation initiale",
      triggers: [
        "Ticket en statut DONE → tout verrouillé, RAF=0",
        "Ticket avec enfants chiffrés → estim et RAF verrouillés (valeurs agrégées)",
        "Ticket à froid (loggedMinutes=0) → estim modifiable, RAF auto-sync",
        "Ticket à chaud (loggedMinutes>0) → estim figée, RAF modifiable",
        "Epic → estim et RAF toujours verrouillés (les Epics ne gèrent pas de temps)",
      ],
    },
    featureFreeze: {
      name: "Gel de l'estimation d'une Feature",
      trigger: "Premier log de temps dans le sous-arbre de la Feature",
      effects: [
        "estimatedMinutes propre de la Feature = snapshot de la valeur hybride courante (estim propre + somme Tasks chiffrées)",
        "frozenAt horodaté à l'instant du gel",
        "RAF post-gel = max(estim gelée - logged initial, 0) + RAF des Tasks créées après frozenAt",
        "Ajout d'une nouvelle Task après le gel → apparaît comme dépassement, l'estim reste inchangée",
      ],
    },
    koWorkflow: {
      name: "Workflow de bug au KO du Test Runner",
      steps: [
        "Testeur lance le Test Runner sur une US ou Feature",
        "Pour chaque cas de test, il clique OK ou KO",
        "Sur KO, commentaire obligatoire + screenshot optionnel",
        "Un Bug est automatiquement créé, rattaché au ticket testé",
        "Le ticket testé passe en statut BLOCKED",
        "Toast visible avec lien vers le bug généré",
      ],
    },
    kanbanVisibility: {
      name: "Filtrage Kanban par rôle",
      rules: {
        ADMIN: "Epics + Features",
        PRODUCT_OWNER: "Epics + Features",
        TESTER: "Epics + Features",
        DEVELOPER: "Tasks + Bugs",
      },
      note: "Depuis une Task, le développeur a un lien 'Spécifications' vers la Feature parente.",
    },
  },

  calculationRules: {
    timeUnit: "Jour-homme (1 jour = 8 heures = 480 minutes)",
    businessCalendar: "Lundi-Vendredi (5 jours). Samedi/dimanche ignorés.",
    endDateCalculation: {
      description: "Date de début inclusive, fraction en fin de période",
      example: "Jeudi + 3 jours → Lundi soir (jeudi=j1, vendredi=j2, lundi=j3)",
      excludedDays: ["Weekends", "Jours fériés globaux (table Holiday)", "Congés personnels de l'assigné (table UserLeave)"],
    },
    featureDatesParallel: {
      description: "Agrégation parallélisée au niveau Feature",
      rules: [
        "startDate Feature = min(startDate des Tasks enfants)",
        "endDate Feature = max(endDate des Tasks enfants)",
        "Les Tasks peuvent être exécutées en parallèle par différentes personnes",
      ],
    },
    rollupAggregation: {
      description: "Vue SQL récursive ticket_rollup",
      fields: {
        totalEstimatedMinutes:
          "Estim initiale : hybride sans gel, snapshot figé après gel Feature",
        totalLoggedMinutes: "Somme de tous les log du sous-arbre (Tasks TODO exclues)",
        totalRemainingMinutes: "RAF total : calcul spécifique pour Features gelées",
        totalProjectedMinutes: "logged + remaining → atterrissage anticipé",
        varianceMinutes: "projection - estim → positif = dépassement",
        progressPercent: "100 * logged / estim",
      },
      excludedFromSums: [
        "Tickets avec isEstimated=false (TODO)",
        "Tickets de type EPIC pour eux-mêmes (retournent 0)",
      ],
    },
  },

  businessConstraints: [
    {
      name: "KO Test Runner requires comment",
      sql: "CHECK (result <> 'KO' OR (comment IS NOT NULL AND length(trim(comment)) > 0))",
      table: "TestExecution",
    },
    {
      name: "Ticket priority range",
      sql: "CHECK (priority BETWEEN 1 AND 5)",
      table: "Ticket",
    },
    {
      name: "Ticket minutes non-negative",
      sql: "CHECK (estimatedMinutes >= 0 AND loggedMinutes >= 0)",
      table: "Ticket",
    },
    {
      name: "Time entry minutes positive",
      sql: "CHECK (minutes > 0 AND minutes <= 14400)",
      table: "TimeEntry",
      description: "Max 30 jours (14400 min) par entrée de log",
    },
    {
      name: "Ticket no self parent",
      sql: "CHECK (parentId IS NULL OR parentId <> id)",
      table: "Ticket",
    },
    {
      name: "Ticket remaining non-negative",
      sql: "CHECK (remainingMinutes IS NULL OR remainingMinutes >= 0)",
      table: "Ticket",
    },
    {
      name: "Ticket dates consistent",
      sql: "CHECK (startDate IS NULL OR endDate IS NULL OR endDate >= startDate)",
      table: "Ticket",
    },
    {
      name: "UserLeave dates consistent",
      sql: "CHECK (endDate >= startDate)",
      table: "UserLeave",
    },
  ],

  securityModel: {
    authentication: "Sessions en BDD (pas de JWT), cookie HttpOnly+Secure+SameSite=Lax, bcrypt coût 12",
    passwordStorage: "bcrypt uniquement, token SHA-256, jamais stockés en clair",
    rateLimits: {
      login: "10 tentatives IP / 5 min + 5 tentatives email / 10 min",
      createTicket: "20 créations / 5 min / user",
      updateTicket: "30 updates / 5 min / user",
      createBug: "20 bugs / 5 min / user",
      testExecution: "120 exécutions / min / tester",
      estimationSession: "10 sessions / 10 min / user",
      holidayCreation: "20 holidays / 5 min / user",
      leaveCreation: "20 leaves / 5 min / user",
    },
    auditLog: {
      description: "Tous les événements sensibles sont tracés",
      events: [
        "AUTH.LOGIN_SUCCESS / LOGIN_FAILED / LOGOUT",
        "TICKET.CREATED / UPDATED / STATUS_CHANGED / DELETED / MOVE",
        "BUG.AUTO_CREATED / MANUAL_CREATED",
        "TICKET.BLOCKED_BY_KO",
        "TEST_RUN.STARTED",
        "TEST_EXECUTION.OK / KO / SKIPPED",
        "TEST_CASE.CREATED / UPDATED / DELETED / REORDERED",
        "TIME.LOG",
        "TASK.CREATED_FROM_ESTIMATION",
        "FEATURE.ESTIMATION_COMPLETED",
        "HOLIDAY.CREATED / DELETED",
        "LEAVE.CREATED / DELETED",
      ],
    },
  },

  availability: {
    holidays: {
      description: "Jours fériés globaux s'appliquant à toute l'équipe",
      table: "Holiday",
      managedBy: ["ADMIN", "PRODUCT_OWNER"],
    },
    userLeaves: {
      description: "Plages de congés individuels",
      table: "UserLeave",
      managedBy: "Self ou ADMIN/PO",
      rule: "Chevauchement refusé pour un même utilisateur",
    },
  },
} as const;
