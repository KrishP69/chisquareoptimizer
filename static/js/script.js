const form = document.getElementById("analyzeForm");
const csvInput = document.getElementById("csvFile");
const manualInput = document.getElementById("manualData");
const analyzeBtn = document.getElementById("analyzeBtn");
const optimizeBtn = document.getElementById("optimizeBtn");
const exportBtn = document.getElementById("exportBtn");
const resultContainer = document.getElementById("resultContainer");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("errorBox");
const warningBox = document.getElementById("warningBox");
const themeToggle = document.getElementById("themeToggle");
const dropZone = document.querySelector(".drop-zone");

let latestObserved = null;
let latestPayload = null;

function setLoading(active) {
    if (active) {
        loading.classList.remove("hidden");
        loading.classList.add("flex");
        analyzeBtn.disabled = true;
        analyzeBtn.classList.add("opacity-60", "cursor-not-allowed");
    } else {
        loading.classList.add("hidden");
        loading.classList.remove("flex");
        analyzeBtn.disabled = false;
        analyzeBtn.classList.remove("opacity-60", "cursor-not-allowed");
    }
}

function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
}

function clearError() {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
}

function showWarning(message) {
    warningBox.textContent = message;
    warningBox.classList.remove("hidden");
}

function clearWarning() {
    warningBox.textContent = "";
    warningBox.classList.add("hidden");
}

function renderResult(html) {
    resultContainer.innerHTML = html;
}

async function parseApiResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        return response.json();
    }

    const text = await response.text();
    return {
        ok: false,
        error: text ? `Server returned a non-JSON response: ${text.slice(0, 180)}` : "Server returned an unexpected response.",
    };
}

function normalizeClientError(error) {
    const message = error?.message || "Unexpected client error.";
    if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
        return "Cannot reach backend server. Please run: python app.py and open http://127.0.0.1:5000";
    }
    return message;
}

function setupTheme() {
    const saved = localStorage.getItem("statopt-theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);

    themeToggle.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") || "dark";
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("statopt-theme", next);
    });
}

function setupDragDrop() {
    if (!dropZone) return;

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            csvInput.files = files;
        }
    });
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    clearWarning();
    setLoading(true);

    try {
        const formData = new FormData(form);
        const response = await fetch("/analyze", {
            method: "POST",
            body: formData,
        });

        const data = await parseApiResponse(response);
        if (!response.ok || !data.ok) {
            throw new Error(data.error || "Unable to analyze dataset.");
        }

        latestObserved = data.observed;
        latestPayload = data.payload;
        renderResult(data.html);
        optimizeBtn.disabled = false;

        if (data.payload.warning && data.payload.warning_message) {
            showWarning(data.payload.warning_message);
        }
    } catch (err) {
        showError(normalizeClientError(err));
    } finally {
        setLoading(false);
    }
});

optimizeBtn.addEventListener("click", async () => {
    clearError();
    clearWarning();

    if (!latestObserved) {
        showError("Please analyze data before optimization.");
        return;
    }

    setLoading(true);
    try {
        const response = await fetch("/optimize", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ observed: latestObserved }),
        });

        const data = await parseApiResponse(response);
        if (!response.ok || !data.ok) {
            throw new Error(data.error || "Unable to optimize dataset.");
        }

        latestPayload = data.payload;
        renderResult(data.html);

        if (data.payload.warning && data.payload.warning_message) {
            showWarning(data.payload.warning_message);
        }
    } catch (err) {
        showError(normalizeClientError(err));
    } finally {
        setLoading(false);
    }
});

exportBtn.addEventListener("click", () => {
    if (!latestPayload) {
        showError("No report to export. Run analysis first.");
        return;
    }

    const report = {
        generatedAt: new Date().toISOString(),
        payload: latestPayload,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "statopt-report.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
});

setupTheme();
setupDragDrop();
