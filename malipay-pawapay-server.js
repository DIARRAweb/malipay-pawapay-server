import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

/* =========================================================
   INITIALISATION
========================================================= */

const app = express();

const PORT =
    Number(process.env.PORT || 3001);

app.use(cors());

app.use(express.json());

/* =========================================================
   ROUTE PRINCIPALE
========================================================= */

app.get("/", (req, res) => {

    res.status(200).json({

        ok: true,

        service: "MaliPay pawaPay Server",

        status: "online",

        environment: "sandbox",

        timestamp: Date.now()

    });

});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", (req, res) => {

    res.status(200).json({

        ok: true,

        status: "healthy"

    });

});

/* =========================================================
   DÉMARRAGE
========================================================= */

app.listen(PORT, () => {

    console.log("====================================");

    console.log("MaliPay pawaPay Server démarré");

    console.log("Port :", PORT);

    console.log("====================================");

});