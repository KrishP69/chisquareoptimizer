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
const successBox = document.getElementById("successBox");
const charCount = document.getElementById("charCount");
const csvSizeHint = document.getElementById("csvSizeHint");

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
    const errorMessage = document.getElementById("errorMessage");
    errorMessage.textContent = message;
    errorBox.classList.remove("hidden");
    clearSuccess();
    clearWarning();
}

function clearError() {
    document.getElementById("errorMessage").textContent = "";
    errorBox.classList.add("hidden");
}

function showWarning(message) {
    const warningMessage = document.getElementById("warningMessage");
    warningMessage.textContent = message;
    warningBox.classList.remove("hidden");
}

function clearWarning() {
    document.getElementById("warningMessage").textContent = "";
    warningBox.classList.add("hidden");
}

function showSuccess(message = "Analysis complete! View results on the right.") {
    document.getElementById("successMessage").textContent = message;
    successBox.classList.remove("hidden");
    clearError();
}

function clearSuccess() {
    successBox.classList.add("hidden");
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

function validateInputData() {
    const manualContent = manualInput.value.trim();
    const hasCSV = csvInput.files && csvInput.files.length > 0;
    
    if (!manualContent && !hasCSV) {
        showError("Please enter data manually or upload a CSV file.");
        return false;
    }
    
    if (manualContent) {
        const lines = manualContent.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
            showError("Table must have at least 2 rows. Example: 10,20\\n15,18");
            return false;
        }
        
        const firstRowLength = lines[0].split(',').length;
        if (firstRowLength < 2) {
            showError("Table must have at least 2 columns. Example: 10,20");
            return false;
        }
    }
    
    return true;
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
    
    if (!validateInputData()) {
        return;
    }
    
    setLoading(true);

    try {
        const formData = new FormData(form);
        const response = await fetch("/analyze", {
            method: "POST",
            body: formData,
        });

        const data = await parseApiResponse(response);
        if (!response.ok || !data.ok) {
            throw new Error(data.error || "Unable to analyze dataset. Check your data format.");
        }

        latestObserved = data.observed;
        latestPayload = data.payload;
        renderResult(data.html);
        
        // Enable optimize button and update step indicator
        optimizeBtn.disabled = false;
        optimizeBtn.classList.remove("opacity-40", "cursor-not-allowed");
        optimizeBtn.classList.add("hover:bg-white/20");
        
        // Scroll to results
        resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        showSuccess(`✅ Analysis complete! Chi-square statistic: ${data.payload.chi2?.toFixed(2) || 'Ready'}`);

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

// Character counter for manual input
manualInput.addEventListener("input", () => {
    const count = manualInput.value.length;
    charCount.textContent = `${count} chars`;
    
    // Add visual feedback if data is present
    if (count > 0) {
        charCount.classList.add("text-cyan-400");
    } else {
        charCount.classList.remove("text-cyan-400");
    }
});

// CSV file size validation and feedback
csvInput.addEventListener("change", () => {
    const file = csvInput.files[0];
    if (file) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(2);
        if (file.size > 10 * 1024 * 1024) {
            csvSizeHint.textContent = `⚠️ File is large (${sizeMB}MB). May take longer to process.`;
            csvSizeHint.classList.add("text-amber-400");
        } else {
            csvSizeHint.textContent = `✅ File ready (${sizeMB}MB)`;
            csvSizeHint.classList.remove("text-amber-400");
            csvSizeHint.classList.add("text-green-400");
        }
    }
});

// Keyboard shortcut hint on form
form.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") {
        form.dispatchEvent(new Event("submit"));
    }
});
