import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "node:crypto";


dotenv.config();


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

      return res.status(200).json({
        ok: accepted,

        accepted,

        final: false,

        message:
          accepted
            ? "La demande de recharge a été envoyée à pawaPay. Elle attend maintenant l’autorisation Mobile Money."
            : "La demande de recharge a été refusée par pawaPay.",

        depositId,

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
   🔍 VÉRIFICATION DU STATUT D’UNE RECHARGE
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

      const paymentStatus =
        found
          ? pawaPayResponse
              ?.data
              ?.status ||
            "UNKNOWN"
          : "NOT_FOUND";

      const final =
        paymentStatus ===
          "COMPLETED" ||
        paymentStatus ===
          "FAILED";

      return res.status(200).json({
        ok: true,

        found,

        final,

        successful:
          paymentStatus ===
          "COMPLETED",

        depositId,

        status:
          paymentStatus,

        data:
          pawaPayResponse?.data ||
          null
      });

    } catch (error) {
      console.error(
        "❌ Erreur statut recharge pawaPay :",
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
            "Impossible de vérifier la recharge.",

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
  (req, res) => {
    const callback =
      req.body &&
      typeof req.body === "object"
        ? req.body
        : {};

    console.log(
      "📥 Callback recharge pawaPay :",
      {
        depositId:
          callback.depositId,

        status:
          callback.status,

        amount:
          callback.amount,

        currency:
          callback.currency,

        provider:
          callback
            ?.payer
            ?.accountDetails
            ?.provider,

        receivedAt:
          new Date()
            .toISOString()
      }
    );

    /*
    Important :
    nous accusons réception du callback.

    À cette étape, ce serveur ne crédite encore aucun
    compte MaliPay. Cette partie sera ajoutée ensuite
    avec une vérification Firebase et une protection
    contre le double crédit.
    */
    return res.status(200).json({
      ok: true,

      received: true
    });
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
