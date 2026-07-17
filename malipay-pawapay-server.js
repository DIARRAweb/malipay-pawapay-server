import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";

import {
  initializeApp,
  cert,
  getApps
} from "firebase-admin/app";

import {
  getDatabase
} from "firebase-admin/database";


dotenv.config();

/* =========================================================
   🔥 FIREBASE ADMIN
========================================================= */

const FIREBASE_DATABASE_URL =
  String(
    process.env.FIREBASE_DATABASE_URL || ""
  ).trim();

const FIREBASE_SERVICE_ACCOUNT_JSON =
  String(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || ""
  ).trim();

function initializeFirebaseAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  if (!FIREBASE_DATABASE_URL) {
    throw new Error(
      "La variable FIREBASE_DATABASE_URL est absente."
    );
  }

  if (!FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error(
      "La variable FIREBASE_SERVICE_ACCOUNT_JSON est absente."
    );
  }

  let serviceAccount;

  try {
    serviceAccount =
      JSON.parse(
        FIREBASE_SERVICE_ACCOUNT_JSON
      );
  } catch (error) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON ne contient pas un JSON valide."
    );
  }

  /*
  Sur Render, les retours à la ligne de private_key
  peuvent avoir été transformés en caractères \\n.
  */
  if (serviceAccount.private_key) {
    serviceAccount.private_key =
      serviceAccount.private_key.replace(
        /\\n/g,
        "\n"
      );
  }

  return initializeApp({
    credential:
      cert(serviceAccount),

    databaseURL:
      FIREBASE_DATABASE_URL
  });
}

const firebaseAdminApp =
  initializeFirebaseAdmin();

const adminDb =
  getDatabase(firebaseAdminApp);


/* =========================================================
   🚀 INITIALISATION
========================================================= */


const app = express();


const PORT =
  Number(process.env.PORT || 3001);


const PAWAPAY_BASE_URL =
  String(
    process.env.PAWAPAY_BASE_URL ||
    "https://api.sandbox.pawapay.io"
  )
    .trim()
    .replace(/\/+$/, "");


const PAWAPAY_API_TOKEN =
  String(
    process.env.PAWAPAY_API_TOKEN || ""
  ).trim();


app.disable("x-powered-by");


app.use(
  cors({
    origin: true,
    methods: [
      "GET",
      "POST",
      "OPTIONS"
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization"
    ]
  })
);


app.use(
  express.json({
    limit: "1mb"
  })
);


/* =========================================================
   🛠️ OUTILS PAWAPAY
========================================================= */


function createPawaPayHeaders() {
  return {
    Authorization:
      `Bearer ${PAWAPAY_API_TOKEN}`,

    Accept:
      "application/json",

    "Content-Type":
      "application/json"
  };
}


async function callPawaPay(
  path,
  options = {}
) {
  if (!PAWAPAY_API_TOKEN) {
    const error =
      new Error(
        "La variable PAWAPAY_API_TOKEN est absente."
      );

    error.status = 500;

    throw error;
  }


  const controller =
    new AbortController();


  const timeout =
    setTimeout(() => {
      controller.abort();
    }, 20000);


  try {
    const response =
      await fetch(
        `${PAWAPAY_BASE_URL}${path}`,
        {
          ...options,

          headers: {
            ...createPawaPayHeaders(),
            ...(options.headers || {})
          },

          signal:
            controller.signal
        }
      );


    const rawText =
      await response.text();


    let data = null;


    try {
      data =
        rawText
          ? JSON.parse(rawText)
          : null;
    } catch {
      data = {
        rawResponse:
          rawText
      };
    }


    if (!response.ok) {
      const error =
        new Error(
          data?.failureReason
            ?.failureMessage ||
          data?.message ||
          `Erreur pawaPay HTTP ${response.status}`
        );


      error.status =
        response.status;


      error.pawaPayResponse =
        data;


      throw error;
    }


    return data;


  } finally {
    clearTimeout(timeout);
  }
}


/* =========================================================
   🏠 ROUTE PRINCIPALE
========================================================= */


app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,

    service:
      "MaliPay pawaPay Server",

    status:
      "online",

    pawaPayEnvironment:
      PAWAPAY_BASE_URL.includes(
        "sandbox"
      )
        ? "sandbox"
        : "production",

    tokenConfigured:
      Boolean(
        PAWAPAY_API_TOKEN
      ),

    timestamp:
      Date.now()
  });
});


/* =========================================================
   ❤️ HEALTH CHECK
========================================================= */


app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,

    status:
      "healthy",

    tokenConfigured:
      Boolean(
        PAWAPAY_API_TOKEN
      ),

    baseUrlConfigured:
      Boolean(
        PAWAPAY_BASE_URL
      )
  });
});



/* =========================================================
   🌍 CONFIGURATION ACTIVE PAWAPAY
========================================================= */

app.get(
  "/pawapay/configuration",
  async (req, res) => {
    try {
      const configuration =
        await callPawaPay(
          "/v2/active-conf",
          {
            method: "GET"
          }
        );

      return res.status(200).json({
        ok: true,

        connected: true,

        environment:
          PAWAPAY_BASE_URL.includes(
            "sandbox"
          )
            ? "sandbox"
            : "production",

        configuration
      });

    } catch (error) {
      console.error(
        "❌ Erreur configuration pawaPay :",
        {
          message: error?.message,
          status: error?.status,
          response:
            error?.pawaPayResponse
        }
      );

      return res
        .status(
          Number(error?.status) || 500
        )
        .json({
          ok: false,

          connected: false,

          error:
            error?.message ||
            "Impossible de communiquer avec pawaPay.",

          details:
            error?.pawaPayResponse ||
            null
        });
    }
  }
);


/* =========================================================
   🧹 NORMALISATION DES DONNÉES PAWAPAY
========================================================= */

function cleanText(
  value,
  maxLength = 200
) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}


function normalizePawaPayPhone(value) {
  let phone =
    cleanText(value, 30)
      .replace(/[^\d+]/g, "");

  if (phone.startsWith("00")) {
    phone = phone.slice(2);
  }

  if (phone.startsWith("+")) {
    phone = phone.slice(1);
  }

  return phone.replace(/\D/g, "");
}


function normalizeProvider(value) {
  return cleanText(value, 100)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
}


function normalizeCurrency(value) {
  return cleanText(value, 10)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}


function normalizeCustomerMessage(value) {
  let message =
    cleanText(
      value || "MaliPay recharge",
      22
    )
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .replace(
        /[^a-zA-Z0-9 ]/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

  if (message.length < 4) {
    message = "MaliPay recharge";
  }

  return message.slice(0, 22);
}


function normalizeClientReference(value) {
  return cleanText(value, 100)
    .replace(
      /[^a-zA-Z0-9._-]/g,
      "-"
    );
}


function isValidUuidV4(value) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value || ""))
  );
}


function createUuidV4() {
  return crypto.randomUUID();
}


function normalizePawaPayAmount(
  value,
  decimalsInAmount
) {
  const amountText =
    cleanText(value, 30)
      .replace(/\s+/g, "")
      .replace(",", ".");


  if (!amountText) {
    throw new Error(
      "Le montant est obligatoire."
    );
  }


  /*
  Format strict :
  - chiffres obligatoires ;
  - maximum deux chiffres après le point ;
  - aucune notation scientifique ;
  - aucun signe négatif.
  */
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
      .test(amountText)
  ) {
    throw new Error(
      "Le montant doit être un nombre positif avec au maximum deux décimales."
    );
  }


  const amountNumber =
    Number(amountText);


  if (
    !Number.isFinite(amountNumber) ||
    amountNumber <= 0
  ) {
    throw new Error(
      "Le montant doit être supérieur à zéro."
    );
  }


  if (
    decimalsInAmount === "NONE"
  ) {
    if (
      !Number.isInteger(amountNumber)
    ) {
      throw new Error(
        "Cet opérateur n’accepte pas les montants avec décimales."
      );
    }


    return String(amountNumber);
  }


  /*
  Pour TWO_PLACES :
  on conserve au maximum deux décimales,
  sans ajouter de troisième décimale.
  */
  return amountNumber
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}


/* =========================================================
   🔎 RECHERCHE D’UN OPÉRATEUR DANS LA CONFIGURATION
========================================================= */

function findDepositConfiguration({
  configuration,
  provider,
  currency
}) {
  const countries =
    Array.isArray(
      configuration?.countries
    )
      ? configuration.countries
      : [];

  for (const country of countries) {
    const providers =
      Array.isArray(country?.providers)
        ? country.providers
        : [];

    const providerConfig =
      providers.find(
        item =>
          item?.provider === provider
      );

    if (!providerConfig) {
      continue;
    }

    const currencies =
      Array.isArray(
        providerConfig?.currencies
      )
        ? providerConfig.currencies
        : [];

    const currencyConfig =
      currencies.find(
        item =>
          item?.currency === currency
      );

    if (!currencyConfig) {
      return {
        found: false,

        reason:
          `La devise ${currency} n’est pas disponible pour ${provider}.`
      };
    }

    const depositConfig =
      currencyConfig
        ?.operationTypes
        ?.DEPOSIT;

    if (!depositConfig) {
      return {
        found: false,

        reason:
          `Les recharges ne sont pas disponibles pour ${provider}.`
      };
    }

    if (
      depositConfig.status !==
      "OPERATIONAL"
    ) {
      return {
        found: false,

        reason:
          `Les recharges sont actuellement indisponibles pour ${provider}.`
      };
    }

    return {
      found: true,

      country:
        country.country,

      countryName:
        country.displayName?.fr ||
        country.displayName?.en ||
        country.country,

      prefix:
        String(country.prefix || ""),

      providerConfig,

      currencyConfig,

      depositConfig
    };
  }

  return {
    found: false,

    reason:
      `L’opérateur ${provider} n’est pas disponible dans la configuration pawaPay.`
  };
}


/* =========================================================
   🔐 ENREGISTREMENT ET CRÉDIT PAWAPAY CÔTÉ SERVEUR
========================================================= */

function normalizeMaliPayUserPhone(value) {
  let phone =
    cleanText(value, 40)
      .replace(/\s+/g, "")
      .replace(/[^\d+]/g, "");

  if (phone.startsWith("00")) {
    phone =
      "+" + phone.slice(2);
  }

  if (!phone.startsWith("+")) {
    phone =
      "+" + phone.replace(/\D/g, "");
  }

  return phone;
}

/* =========================================================
   🔎 RECHERCHE FIABLE DU COMPTE MALIPAY
========================================================= */

function getPhoneDigits(value) {
  return String(value || "")
    .replace(/\D/g, "");
}


function getMaliPayUserKeyCandidates(value) {
  const rawValue =
    cleanText(value, 40)
      .replace(/\s+/g, "");

  const digitsOnly =
    getPhoneDigits(rawValue);

  const normalizedWithPlus =
    normalizeMaliPayUserPhone(
      rawValue
    );

  const candidates = [
    rawValue,

    normalizedWithPlus,

    digitsOnly,

    digitsOnly
      ? "+" + digitsOnly
      : "",

    /*
    Numéro national sans indicatif malien.
    Exemple :
    22374816685 devient 74816685.
    */
    digitsOnly.startsWith("223") &&
    digitsOnly.length > 8
      ? digitsOnly.slice(3)
      : ""
  ]
    .filter(Boolean)
    .filter(
      (candidate, index, list) =>
        list.indexOf(candidate) === index
    );

  return candidates;
}


async function resolveMaliPayUserKey(
  phoneValue
) {
  const searchedDigits =
    getPhoneDigits(
      phoneValue
    );

  const searchedNationalDigits =
    searchedDigits.startsWith("223") &&
    searchedDigits.length > 8
      ? searchedDigits.slice(3)
      : searchedDigits;

  const candidates =
    getMaliPayUserKeyCandidates(
      phoneValue
    );

  /*
  1. Recherche directe avec toutes les formes
  raisonnables de la clé Firebase.
  */
  for (const candidate of candidates) {
    const snapshot =
      await adminDb
        .ref(
          `users/${candidate}`
        )
        .get();

    if (snapshot.exists()) {
      return {
        found: true,

        userKey:
          candidate,

        userData:
          snapshot.val() || {},

        matchType:
          "direct_key",

        candidates
      };
    }
  }

  /*
  2. Recherche de secours dans users/.

  Elle compare :
  - les chiffres de la clé Firebase ;
  - le champ phone enregistré dans l’utilisateur ;
  - le numéro avec indicatif ;
  - le numéro national sans indicatif.
  */
  const usersSnapshot =
    await adminDb
      .ref("users")
      .get();

  if (usersSnapshot.exists()) {
    const users =
      usersSnapshot.val() || {};

    for (
      const [userKey, userData]
      of Object.entries(users)
    ) {
      const keyDigits =
        getPhoneDigits(
          userKey
        );

      const storedPhoneDigits =
        getPhoneDigits(
          userData?.phone || ""
        );

      const keyNationalDigits =
        keyDigits.startsWith("223") &&
        keyDigits.length > 8
          ? keyDigits.slice(3)
          : keyDigits;

      const storedNationalDigits =
        storedPhoneDigits.startsWith("223") &&
        storedPhoneDigits.length > 8
          ? storedPhoneDigits.slice(3)
          : storedPhoneDigits;

      const matches =
        Boolean(searchedDigits) &&
        (
          keyDigits === searchedDigits ||

          storedPhoneDigits ===
            searchedDigits ||

          keyNationalDigits ===
            searchedNationalDigits ||

          storedNationalDigits ===
            searchedNationalDigits
        );

      if (matches) {
        return {
          found: true,

          userKey,

          userData:
            userData || {},

          matchType:
            keyDigits === searchedDigits
              ? "key_digits"
              : storedPhoneDigits ===
                  searchedDigits
              ? "stored_phone"
              : keyNationalDigits ===
                  searchedNationalDigits
              ? "national_key"
              : "national_stored_phone",

          candidates
        };
      }
    }
  }

  return {
    found: false,

    userKey: "",

    userData: null,

    matchType:
      "not_found",

    candidates
  };
}

function getObjectPathValue(
  root,
  pathParts
) {
  let current = root;

  for (const part of pathParts) {
    if (
      !current ||
      typeof current !== "object"
    ) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function ensureObjectPath(
  root,
  pathParts
) {
  let current = root;

  for (const part of pathParts) {
    if (
      !current[part] ||
      typeof current[part] !== "object"
    ) {
      current[part] = {};
    }

    current = current[part];
  }

  return current;
}

function getMaliPayUserCurrency(
  rootData,
  userPhone
) {
  const currencies =
    rootData?.currencies &&
    typeof rootData.currencies === "object"
      ? rootData.currencies
      : {};

  const prefixes =
    Object.keys(currencies)
      .sort(
        (a, b) =>
          b.length - a.length
      );

  for (const prefix of prefixes) {
    if (
      String(userPhone || "")
        .startsWith(prefix)
    ) {
      return (
        currencies[prefix]?.code ||
        "XOF"
      );
    }
  }

  return "XOF";
}

async function savePawaPayDepositMapping({
  depositId,
  userPhone,
  customID,
  provider,
  currency,
  phoneNumber,
  amount,
  country,
  customerMessage,
  status
}) {
  if (!depositId || !userPhone) {
    throw new Error(
      "Impossible d’enregistrer la correspondance du dépôt."
    );
  }

  const mappingRef =
    adminDb.ref(
      `pawaPayDeposits/${depositId}`
    );

  const existingSnapshot =
    await mappingRef.get();

  if (existingSnapshot.exists()) {
    const existing =
      existingSnapshot.val() || {};

    if (
      existing.userPhone &&
      existing.userPhone !== userPhone
    ) {
      throw new Error(
        "Ce depositId appartient déjà à un autre compte."
      );
    }
  }

  await mappingRef.update({
    depositId,
    userPhone,
    customID:
      customID || "",

    provider:
      provider || "",

    currency:
      currency || "",

    paymentPhone:
      phoneNumber || "",

    amount:
      String(amount || ""),

    country:
      country || "",

    customerMessage:
      customerMessage || "",

    status:
      status || "ACCEPTED",

    final:
      false,

    successful:
      false,

    balanceCredited:
      false,

    createdAt:
      existingSnapshot.exists()
        ? existingSnapshot.val()
            ?.createdAt ||
          Date.now()
        : Date.now(),

    updatedAt:
      Date.now()
  });
}

async function creditCompletedPawaPayDeposit(
  verifiedDeposit
) {
  const depositId =
    cleanText(
      verifiedDeposit?.depositId,
      50
    );

  const status =
    cleanText(
      verifiedDeposit?.status,
      30
    ).toUpperCase();

  if (!isValidUuidV4(depositId)) {
    throw new Error(
      "Deposit ID invalide."
    );
  }

  if (status !== "COMPLETED") {
    return {
      credited: false,
      alreadyCredited: false,
      reason:
        "Le dépôt n’est pas COMPLETED."
    };
  }

  /* =====================================================
     1. RÉCUPÉRER LE MAPPING MALIPAY DU DÉPÔT
  ===================================================== */

  const mappingRef =
    adminDb.ref(
      `pawaPayDeposits/${depositId}`
    );

  const mappingSnapshot =
    await mappingRef.get();

  if (!mappingSnapshot.exists()) {
    throw new Error(
      "Ce dépôt n’est pas enregistré dans MaliPay."
    );
  }

    const mapping =
    mappingSnapshot.val() || {};

  const rawMappedUserPhone =
    cleanText(
      mapping.userPhone,
      40
    );

  if (!rawMappedUserPhone) {
    throw new Error(
      "Le compte MaliPay associé est invalide."
    );
  }

  /*
  Recherche du compte en essayant les différentes
  formes possibles du numéro :

  +223XXXXXXXX
  223XXXXXXXX
  valeur originale enregistrée
  */
  const resolvedUser =
    await resolveMaliPayUserKey(
      rawMappedUserPhone
    );

  if (!resolvedUser.found) {
    console.error(
      "❌ Compte MaliPay introuvable dans Firebase Admin :",
      {
        mappedUserPhone:
          rawMappedUserPhone,

        testedKeys:
          resolvedUser.candidates,

        databaseURL:
          FIREBASE_DATABASE_URL
      }
    );

    throw new Error(
      "Le compte MaliPay est introuvable. Clés testées : " +
      resolvedUser.candidates.join(", ")
    );
  }

  /*
  userPhone devient ici la véritable clé
  retrouvée dans users/.
  */
  const userPhone =
    resolvedUser.userKey;

      console.log(
    "✅ Compte MaliPay retrouvé pour le crédit pawaPay :",
    {
      depositId,

      mappedUserPhone:
        rawMappedUserPhone,

      resolvedUserKey:
        userPhone,

      matchType:
        resolvedUser.matchType ||
        "direct_key"
    }
  );

  /* =====================================================
     2. VÉRIFIER LE MONTANT ET LA DEVISE
  ===================================================== */

  const verifiedAmount =
    Number(
      verifiedDeposit?.amount
    );

  const registeredAmount =
    Number(
      mapping.amount
    );

  const verifiedCurrency =
    normalizeCurrency(
      verifiedDeposit?.currency
    );

  const registeredCurrency =
    normalizeCurrency(
      mapping.currency
    );

  if (
    !Number.isFinite(verifiedAmount) ||
    verifiedAmount <= 0
  ) {
    throw new Error(
      "Le montant confirmé par pawaPay est invalide."
    );
  }

  if (
    !Number.isFinite(registeredAmount) ||
    registeredAmount <= 0
  ) {
    throw new Error(
      "Le montant enregistré dans MaliPay est invalide."
    );
  }

  if (
    Math.abs(
      verifiedAmount -
      registeredAmount
    ) > 0.000001
  ) {
    throw new Error(
      "Le montant confirmé par pawaPay ne correspond pas au montant enregistré."
    );
  }

  if (
    !verifiedCurrency ||
    verifiedCurrency !==
      registeredCurrency
  ) {
    throw new Error(
      "La devise confirmée par pawaPay ne correspond pas à la devise enregistrée."
    );
  }

  /* =====================================================
     3. VÉRIFIER LA DEVISE DU COMPTE MALIPAY
  ===================================================== */

  const currenciesSnapshot =
    await adminDb
      .ref("currencies")
      .get();

  const userCurrency =
    getMaliPayUserCurrency(
      {
        currencies:
          currenciesSnapshot.exists()
            ? currenciesSnapshot.val()
            : {}
      },
      userPhone
    );

  if (
    userCurrency !==
    verifiedCurrency
  ) {
    throw new Error(
      "La devise du dépôt ne correspond pas à celle du compte MaliPay."
    );
  }

  /*
  Clé Firebase sécurisée et déterministe.

  Elle permet d’enregistrer le Deposit ID directement
  dans le compte utilisateur et d’empêcher définitivement
  un deuxième crédit.
  */
  const safeDepositKey =
    depositId.replace(
      /[.#$\[\]\/]/g,
      "_"
    );

  const userRef =
    adminDb.ref(
      `users/${userPhone}`
    );

  let transactionResultType =
    "unknown";

  /* =====================================================
     4. TRANSACTION UNIQUEMENT SUR LE COMPTE UTILISATEUR
  ===================================================== */

  const userTransaction =
    await userRef.transaction(
      userData => {
        if (
          !userData ||
          typeof userData !== "object"
        ) {
          transactionResultType =
            "user_not_found";

          return;
        }

        if (userData.frozen === true) {
          transactionResultType =
            "user_frozen";

          return;
        }

        if (
          !userData.pawapayCredits ||
          typeof userData.pawapayCredits !==
            "object"
        ) {
          userData.pawapayCredits = {};
        }

        /*
        Protection contre le double crédit.

        Si ce Deposit ID est déjà présent dans le compte,
        aucun montant n’est ajouté une deuxième fois.
        */
        if (
          userData
            .pawapayCredits
            [safeDepositKey]
        ) {
          transactionResultType =
            "already_credited";

          return userData;
        }

        const currentBalance =
          Number(
            userData.solde || 0
          );

        if (
          !Number.isFinite(
            currentBalance
          )
        ) {
          transactionResultType =
            "invalid_balance";

          return;
        }

        const creditedAt =
          Date.now();

        const newBalance =
          currentBalance +
          verifiedAmount;

        userData.solde =
          newBalance;

        userData
          .pawapayCredits
          [safeDepositKey] = {
            depositId,

            creditedAmount:
              verifiedAmount,

            originalAmount:
              verifiedAmount,

            paymentCurrency:
              verifiedCurrency,

            walletCurrency:
              userCurrency,

            conversionRate:
              1,

            balanceBefore:
              currentBalance,

            balanceAfter:
              newBalance,

            creditedAt
          };

        transactionResultType =
          "credited";

        return userData;
      },
      undefined,
      false
    );

  /* =====================================================
     5. RELIRE LE COMPTE APRÈS LA TRANSACTION
  ===================================================== */

  const freshUserSnapshot =
    await userRef.get();

  if (!freshUserSnapshot.exists()) {
    throw new Error(
      "Le compte MaliPay est introuvable après la transaction."
    );
  }

  const freshUser =
    freshUserSnapshot.val() || {};

  const creditInformation =
    freshUser
      ?.pawapayCredits
      ?.[safeDepositKey];

  /*
  Si le Deposit ID est déjà présent, cela signifie
  qu’un callback ou une vérification précédente
  avait déjà crédité ce dépôt.
  */
  const alreadyCredited =
    transactionResultType ===
      "already_credited";

  const creditedNow =
    transactionResultType ===
      "credited" &&
    userTransaction.committed === true;

  if (
    !creditInformation &&
    !creditedNow
  ) {
    const errorMessages = {
      user_not_found:
        "Le compte MaliPay est introuvable.",

      user_frozen:
        "Le compte MaliPay est gelé.",

      invalid_balance:
        "Le solde actuel du compte est invalide."
    };

    throw new Error(
      errorMessages[
        transactionResultType
      ] ||
      "Le crédit automatique Firebase a été refusé."
    );
  }

  const creditedAmount =
    Number(
      creditInformation
        ?.creditedAmount ||
      verifiedAmount
    );

  const balanceBefore =
    Number(
      creditInformation
        ?.balanceBefore || 0
    );

  const balanceAfter =
    Number(
      creditInformation
        ?.balanceAfter ||
      freshUser.solde ||
      0
    );

  const creditedAt =
    Number(
      creditInformation
        ?.creditedAt ||
      Date.now()
    );

  /* =====================================================
     6. RÉCUPÉRER L’ANCIENNE DEMANDE TOPUP
  ===================================================== */

  const topupRequestRef =
    adminDb.ref(
      `topupRequests/${userPhone}/${depositId}`
    );

  const topupRequestSnapshot =
    await topupRequestRef.get();

  const existingTopupRequest =
    topupRequestSnapshot.exists()
      ? topupRequestSnapshot.val() || {}
      : {};

  /*
  Identifiants déterministes.

  Le même Deposit ID écrase toujours le même historique
  et la même notification au lieu de créer des doublons.
  */
  const historyId =
    `pawapay_${safeDepositKey}`;

  const notificationId =
    `pawapay_${safeDepositKey}`;

  /* =====================================================
     7. SYNCHRONISATION MULTI-CHEMINS FIREBASE
  ===================================================== */

  const updates = {};

  updates[
    `pawaPayDeposits/${depositId}`
  ] = {
    ...mapping,

    depositId,

    userPhone,

    status:
      "COMPLETED",

    final:
      true,

    successful:
      true,

    balanceCredited:
      true,

    creditedAmount,

    creditedCurrency:
      verifiedCurrency,

    balanceBeforeCredit:
      balanceBefore,

    balanceAfterCredit:
      balanceAfter,

    creditedAt,

    updatedAt:
      Date.now()
  };

  updates[
    `topupRequests/${userPhone}/${depositId}`
  ] = {
    ...existingTopupRequest,

    customID:
      mapping.customID || "",

    depositId,

    userPhone,

    userName:
      freshUser.name || "",

    country:
      mapping.country || "",

    provider:
      mapping.provider || "",

    currency:
      verifiedCurrency,

    paymentPhone:
      mapping.paymentPhone || "",

    amount:
      String(
        verifiedAmount
      ),

    customerMessage:
      mapping.customerMessage || "",

    status:
      "COMPLETED",

    accepted:
      true,

    final:
      true,

    successful:
      true,

    balanceCredited:
      true,

    creditedAmount,

    originalPaidAmount:
      verifiedAmount,

    paymentCurrency:
      verifiedCurrency,

    walletCurrency:
      userCurrency,

    conversionRate:
      1,

    balanceBeforeCredit:
      balanceBefore,

    balanceAfterCredit:
      balanceAfter,

    providerName:
      "pawaPay",

    completedAt:
      creditedAt,

    creditedAt,

    updatedAt:
      Date.now()
  };

  updates[
    `history/${userPhone}/${historyId}`
  ] = {
    customID:
      mapping.customID ||
      `PAWAPAY-${depositId}`,

    depositId,

    type:
      "pawapay_topup",

    from:
      mapping.paymentPhone ||
      "pawaPay",

    to:
      userPhone,

    provider:
      mapping.provider ||
      "pawaPay",

    providerName:
      "pawaPay",

    amountOriginal:
      verifiedAmount,

    originalCurrency:
      verifiedCurrency,

    amountConverted:
      creditedAmount,

    walletCurrency:
      userCurrency,

    conversionRate:
      1,

    serviceFee:
      0,

    startupFee:
      0,

    totalFees:
      0,

    rateUsed:
      "Recharge pawaPay",

    reason:
      "Recharge Mobile Money confirmée par pawaPay",

    status:
      "COMPLETED",

    date:
      new Date(
        creditedAt
      ).toLocaleString(
        "fr-FR"
      ),

    createdAt:
      creditedAt
  };

  updates[
    `notifications/${userPhone}/${notificationId}`
  ] = {
    title:
      "✅ Solde MALIPAY crédité",

    phone:
      mapping.paymentPhone ||
      userPhone,

    amount:
      creditedAmount,

    currency:
      userCurrency,

    symbol:
      userCurrency,

    originalAmount:
      verifiedAmount,

    originalCurrency:
      verifiedCurrency,

    reason:
      "Recharge confirmée et créditée par pawaPay",

    depositId,

    customID:
      mapping.customID || "",

    status:
      "COMPLETED",

    balanceCredited:
      true,

    date:
      new Date(
        creditedAt
      ).toLocaleString(
        "fr-FR"
      ),

    createdAt:
      creditedAt,

    seen:
      false,

    claimable:
      false
  };

  await adminDb
    .ref("/")
    .update(updates);

  return {
    credited:
      creditedNow,

    alreadyCredited:
      alreadyCredited ||
      (
        !creditedNow &&
        Boolean(
          creditInformation
        )
      ),

    depositId,

    userPhone,

    amount:
      creditedAmount,

    currency:
      userCurrency,

    newBalance:
      balanceAfter
  };
}

async function verifyAndCreditPawaPayDeposit(
  depositId
) {
  const pawaPayResponse =
    await callPawaPay(
      `/v2/deposits/${encodeURIComponent(
        depositId
      )}`,
      {
        method: "GET"
      }
    );

  const found =
    pawaPayResponse?.status ===
    "FOUND";

  if (!found) {
    return {
      found: false,
      status:
        "NOT_FOUND",
      credited:
        false,
      alreadyCredited:
        false,
      data:
        null
    };
  }

  const depositData =
    pawaPayResponse?.data || {};

  const status =
    depositData.status ||
    "UNKNOWN";

  let creditResult = {
    credited: false,
    alreadyCredited: false
  };

  if (status === "COMPLETED") {
    creditResult =
      await creditCompletedPawaPayDeposit(
        depositData
      );
  }

  return {
    found: true,
    status,
    data:
      depositData,
    ...creditResult
  };
}


/* =========================================================
   💰 CRÉATION D’UNE RECHARGE PAWAPAY
========================================================= */

app.post(
  "/pawapay/deposit",
  async (req, res) => {
    try {
      const provider =
        normalizeProvider(
          req.body?.provider
        );

      const currency =
        normalizeCurrency(
          req.body?.currency
        );

      const phoneNumber =
        normalizePawaPayPhone(
          req.body?.phoneNumber
        );

      const requestedDepositId =
        cleanText(
          req.body?.depositId,
          50
        );

      const depositId =
        isValidUuidV4(
          requestedDepositId
        )
          ? requestedDepositId
          : createUuidV4();

      const clientReferenceId =
        normalizeClientReference(
          req.body
            ?.clientReferenceId ||
          `MALIPAY-${Date.now()}`
        );

      const customerMessage =
        normalizeCustomerMessage(
          req.body?.customerMessage
        );

            const requestedUserPhone =
        cleanText(
          req.body?.userPhone,
          40
        );

      if (!requestedUserPhone) {
        return res.status(400).json({
          ok: false,

          error:
            "Le compte MaliPay associé à la recharge est invalide."
        });
      }

      /*
      Retrouver la véritable clé Firebase avant
      de créer la recharge pawaPay.

      Ainsi, pawaPayDeposits/{depositId}/userPhone
      contiendra toujours la clé réelle de users/.
      */
      const resolvedMaliPayUser =
        await resolveMaliPayUserKey(
          requestedUserPhone
        );

      if (!resolvedMaliPayUser.found) {
        console.error(
          "❌ Création Deposit refusée : compte MaliPay introuvable.",
          {
            requestedUserPhone,

            testedKeys:
              resolvedMaliPayUser.candidates,

            databaseURL:
              FIREBASE_DATABASE_URL
          }
        );

        return res.status(404).json({
          ok: false,

          accepted: false,

          final: false,

          error:
            "Le compte MaliPay associé à cette recharge est introuvable."
        });
      }

      /*
      userPhone est désormais la clé exacte
      présente sous users/ dans Firebase.
      */
      const userPhone =
        resolvedMaliPayUser.userKey;

      console.log(
        "✅ Compte MaliPay identifié avant Deposit :",
        {
          requestedUserPhone,

          userPhone,

          matchType:
            resolvedMaliPayUser.matchType
        }
      );

      if (!provider) {
        return res.status(400).json({
          ok: false,

          error:
            "L’opérateur Mobile Money est obligatoire."
        });
      }

      if (!currency) {
        return res.status(400).json({
          ok: false,

          error:
            "La devise est obligatoire."
        });
      }

      if (
        !phoneNumber ||
        phoneNumber.length < 8
      ) {
        return res.status(400).json({
          ok: false,

          error:
            "Le numéro Mobile Money est invalide."
        });
      }

      /*
      Nous récupérons toujours la configuration active.
      Ainsi, les limites et les opérateurs ne sont pas
      écrits manuellement dans le serveur.
      */
      const configuration =
        await callPawaPay(
          "/v2/active-conf",
          {
            method: "GET"
          }
        );

      const activeConfig =
        findDepositConfiguration({
          configuration,
          provider,
          currency
        });

      if (!activeConfig.found) {
        return res.status(400).json({
          ok: false,

          error:
            activeConfig.reason
        });
      }

      if (
        activeConfig.prefix &&
        !phoneNumber.startsWith(
          activeConfig.prefix
        )
      ) {
        return res.status(400).json({
          ok: false,

          error:
            `Le numéro doit commencer par l’indicatif ${activeConfig.prefix} pour ${activeConfig.countryName}.`
        });
      }

      const amount =
        normalizePawaPayAmount(
          req.body?.amount,
          activeConfig
            .depositConfig
            .decimalsInAmount
        );

      const numericAmount =
        Number(amount);

      const minimum =
        Number(
          activeConfig
            .depositConfig
            .minAmount
        );

      const maximum =
        Number(
          activeConfig
            .depositConfig
            .maxAmount
        );

      if (
        Number.isFinite(minimum) &&
        numericAmount < minimum
      ) {
        return res.status(400).json({
          ok: false,

          error:
            `Le montant minimum pour cet opérateur est de ${minimum} ${currency}.`
        });
      }

      if (
        Number.isFinite(maximum) &&
        numericAmount > maximum
      ) {
        return res.status(400).json({
          ok: false,

          error:
            `Le montant maximum pour cet opérateur est de ${maximum} ${currency}.`
        });
      }

      const payload = {
        depositId,

        payer: {
          type: "MMO",

          accountDetails: {
            phoneNumber,
            provider
          }
        },

        amount,

        currency,

        clientReferenceId,

        customerMessage,

        metadata: [
          {
            source:
              "MALIPAY"
          },

          {
            operation:
              "ACCOUNT_TOPUP"
          }
        ]
      };

      const pawaPayResponse =
        await callPawaPay(
          "/v2/deposits",
          {
            method: "POST",

            body:
              JSON.stringify(
                payload
              )
          }
        );

      const accepted =
        pawaPayResponse?.status ===
          "ACCEPTED" ||
        pawaPayResponse?.status ===
          "DUPLICATE_IGNORED";

      if (accepted) {
        await savePawaPayDepositMapping({
          depositId,
          userPhone,
          customID:
            clientReferenceId,
          provider,
          currency,
          phoneNumber,
          amount,
          country:
            activeConfig.country,
          customerMessage,
          status:
            pawaPayResponse?.status ||
            "ACCEPTED"
        });
      }

      return res.status(200).json({
        ok: accepted,

        accepted,

        final: false,

        message:
          accepted
            ? "La demande de recharge a été envoyée à pawaPay. Elle attend maintenant l’autorisation Mobile Money."
            : "La demande de recharge a été refusée par pawaPay.",

        depositId,

        userPhone,

        provider,

        phoneNumber,

        amount,

        currency,

        country:
          activeConfig.country,

        status:
          pawaPayResponse?.status ||
          "UNKNOWN",

        failureReason:
          pawaPayResponse
            ?.failureReason ||
          null,

        pawaPayResponse
      });

    } catch (error) {
      console.error(
        "❌ Erreur création recharge pawaPay :",
        {
          message:
            error?.message,

          status:
            error?.status,

          response:
            error?.pawaPayResponse
        }
      );

      return res
        .status(
          Number(error?.status) ||
          500
        )
        .json({
          ok: false,

          accepted: false,

          final: false,

          error:
            error?.message ||
            "Impossible de créer la recharge pawaPay.",

          details:
            error?.pawaPayResponse ||
            null
        });
    }
  }
);


/* =========================================================
   🔍 VÉRIFICATION DU STATUT ET CRÉDIT SERVEUR
========================================================= */

app.get(
  "/pawapay/deposit/:depositId",
  async (req, res) => {
    try {
      const depositId =
        cleanText(
          req.params.depositId,
          50
        );

      if (
        !isValidUuidV4(depositId)
      ) {
        return res.status(400).json({
          ok: false,

          error:
            "L’identifiant de recharge est invalide."
        });
      }

      const result =
        await verifyAndCreditPawaPayDeposit(
          depositId
        );

      const final =
        result.status ===
          "COMPLETED" ||
        result.status ===
          "FAILED";

            return res.status(200).json({
        ok: true,

        found:
          result.found,

        final,

        successful:
          result.status ===
          "COMPLETED",

        depositId,

        status:
          result.status,

        balanceCredited:
          result.credited === true ||
          result.alreadyCredited ===
            true,

        creditedNow:
          result.credited === true,

        alreadyCredited:
          result.alreadyCredited ===
            true,

        creditedAmount:
          Number(
            result.amount || 0
          ),

        creditedCurrency:
          result.currency || "",

        newBalance:
          result.newBalance !== undefined
            ? Number(result.newBalance)
            : null,

        userPhone:
          result.userPhone || "",

        data:
          result.data ||
          null
      });

    } catch (error) {
      console.error(
        "❌ Erreur statut/crédit pawaPay :",
        {
          message:
            error?.message,

          status:
            error?.status,

          response:
            error?.pawaPayResponse
        }
      );

      return res
        .status(
          Number(error?.status) ||
          500
        )
        .json({
          ok: false,

          error:
            error?.message ||
            "Impossible de vérifier ou créditer la recharge.",

          details:
            error?.pawaPayResponse ||
            null
        });
    }
  }
);

/* =========================================================
   📥 CALLBACK DE RECHARGE PAWAPAY
========================================================= */

app.post(
  "/pawapay/deposit-callback",
  async (req, res) => {
    const callback =
      req.body &&
      typeof req.body === "object"
        ? req.body
        : {};

    const depositId =
      cleanText(
        callback.depositId,
        50
      );

    console.log(
      "📥 Callback recharge pawaPay reçu :",
      {
        depositId,

        callbackStatus:
          callback.status,

        receivedAt:
          new Date()
            .toISOString()
      }
    );

    if (
      !isValidUuidV4(depositId)
    ) {
      return res.status(400).json({
        ok: false,

        error:
          "Deposit ID invalide."
      });
    }

    try {
      /*
      Ne jamais créditer directement avec les données
      envoyées dans le callback.

      Le serveur interroge lui-même pawaPay afin de
      confirmer le statut, le montant et la devise.
      */
      const result =
        await verifyAndCreditPawaPayDeposit(
          depositId
        );

      console.log(
        "✅ Callback pawaPay traité :",
        {
          depositId,

          status:
            result.status,

          credited:
            result.credited,

          alreadyCredited:
            result.alreadyCredited
        }
      );

      return res.status(200).json({
        ok: true,

        received: true,

        verified:
          result.found === true,

        status:
          result.status,

        balanceCredited:
          result.credited === true ||
          result.alreadyCredited ===
            true,

        creditedNow:
          result.credited === true,

        alreadyCredited:
          result.alreadyCredited ===
            true
      });

    } catch (error) {
      console.error(
        "❌ Erreur traitement callback pawaPay :",
        {
          depositId,

          message:
            error?.message,

          status:
            error?.status,

          details:
            error?.pawaPayResponse
        }
      );

      /*
      Une erreur 500 permet au fournisseur de considérer
      que le callback n’a pas été correctement traité.
      */
      return res.status(500).json({
        ok: false,

        received: true,

        balanceCredited:
          false,

        error:
          error?.message ||
          "Le callback n’a pas pu être traité."
      });
    }
  }
);

/* =========================================================
   📤 CALLBACK DE RETRAIT / PAYOUT
========================================================= */

app.post(
  "/pawapay/payment-callback",
  (req, res) => {
    console.log(
      "📤 Callback payout pawaPay :",
      {
        payoutId:
          req.body?.payoutId,

        status:
          req.body?.status,

        receivedAt:
          new Date()
            .toISOString()
      }
    );

    return res.status(200).json({
      ok: true,

      received: true
    });
  }
);


/* =========================================================
   ↩️ CALLBACK DE REMBOURSEMENT
========================================================= */

app.post(
  "/pawapay/refund-callback",
  (req, res) => {
    console.log(
      "↩️ Callback remboursement pawaPay :",
      {
        refundId:
          req.body?.refundId,

        status:
          req.body?.status,

        receivedAt:
          new Date()
            .toISOString()
      }
    );

    return res.status(200).json({
      ok: true,

      received: true
    });
  }
);


/* =========================================================
   🚫 ROUTE INTROUVABLE
========================================================= */


app.use((req, res) => {
  res.status(404).json({
    ok: false,

    error:
      "Route introuvable"
  });
});


/* =========================================================
   🧯 ERREUR EXPRESS
========================================================= */


app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "❌ Erreur serveur :",
      error?.message
    );


    res.status(500).json({
      ok: false,

      error:
        "Erreur interne du serveur"
    });
  }
);


/* =========================================================
   🚀 DÉMARRAGE
========================================================= */


app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "===================================="
    );


    console.log(
      "✅ MaliPay pawaPay Server démarré"
    );


    console.log(
      "🌐 Port :",
      PORT
    );


    console.log(
      "🧪 Environnement pawaPay :",
      PAWAPAY_BASE_URL.includes(
        "sandbox"
      )
        ? "sandbox"
        : "production"
    );


    console.log(
      "🔑 Jeton configuré :",
      PAWAPAY_API_TOKEN
        ? "Oui"
        : "Non"
    );


    console.log(
      "===================================="
    );
  }
);
