import express from "express";
import cors from "cors";
import dotenv from "dotenv";


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
            method:
              "GET"
          }
        );


      return res
        .status(200)
        .json({
          ok: true,

          connected:
            true,

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
          Number(
            error?.status
          ) || 500
        )
        .json({
          ok: false,

          connected:
            false,

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
