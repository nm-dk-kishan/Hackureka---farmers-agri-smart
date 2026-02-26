try { ensureAuth() } catch(e) { console.error('Auth failed:', e); location.href='auth.html' }

let liveMarketChart, fifteenChart, riskChart, nutrientChart

let cropSeedRequestInFlight = false
const cropSeedApiUrl = 'http://127.0.0.1:5001/ask'

const riskData = {
  wheat: {
    risks: { Aphids: 65, Rot: 45, Rust: 72, Mites: 38, Wilt: 52, Blight: 40 },
    prevention: [
      { risk: 'High', issue: 'Aphid infestation risk', action: 'Apply neem-based pesticide. Monitor undersides of leaves.' },
      { risk: 'Medium', issue: 'Rust fungus possibility', action: 'Use fungicide spray at flowering stage. Ensure proper spacing' }
    ],
    chemicals: [
      'Imidacloprid 17.8% SL - 0.3ml/l for aphids',
      'Propiconazole 25% EC - 1ml/l for rust'
    ]
  },
  rice: {
    risks: { Blast: 68, Sheath: 55, Brown: 42, Mites: 30, Borer: 60, Wilt: 35 },
    prevention: [
      { risk: 'High', issue: 'Blast disease risk', action: 'Apply carbendazim fungicide. Maintain field hygiene.' },
      { risk: 'Medium', issue: 'Stem borer activity', action: 'Use pheromone traps. Monitor crop regularly' }
    ],
    chemicals: [
      'Carbendazim 50% WP - 1g/l for blast',
      'Fipronil 5% SC - 1.5ml/l for borers'
    ]
  }
}

const fixedMspByCrop = {
  wheat: 2174,
  millet: 2900,
  sunflower: 4000,
  cotton: 5000,
  maize: 1300
}

function switchTab(tabName, evt) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none')
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'))
  
  // Show selected tab
  const tab = document.getElementById(tabName + '-tab')
  if (tab) {
    tab.style.display = 'block'
    const activeBtn = evt?.target || document.querySelector(`.tab-btn[onclick*="'${tabName}'"]`)
    if (activeBtn) activeBtn.classList.add('active')
  }
}

function initCharts() {
  try {
    const ffCtx = document.getElementById('fifteenDayForecast')

    if (!ffCtx) { console.error('Chart containers not found'); return }
 
    // placeholder fifteen-day chart (updated when server returns predictions)
    fifteenChart = new Chart(ffCtx, {
      type: 'line',
      data: {
        labels: ['Day 1','Day 2','Day 3','Day 4','Day 5','Day 6'],
        datasets: [{ label: '15-Day Price', data: [0,0,0,0,0,0], borderColor: '#2e7d32', backgroundColor: 'rgba(46,125,50,0.06)', tension: 0.4 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } }
    })

    populateStaticSections()
    bindCropSeedEvents()
    initRiskChart()
    initNutrientChart()
  } catch(e) {
    console.error('Chart init error:', e)
    toast('Failed to initialize charts', 3000)
  }
}

async function fetchLiveMarketPrice(crop, state) {
  try {
    const toNumber = (value) => {
      const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    const parseDate = (value) => {
      const raw = String(value || '').trim()
      if (!raw) return new Date(0)
      const d = new Date(raw)
      if (!Number.isNaN(d.getTime())) return d
      const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
      if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
      return new Date(0)
    }
    const norm = (v) => String(v || '').trim().toLowerCase()

    const url = `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?api-key=579b464db66ec23bdd00000191ff622c3533490d64d039d1a1cfd06b&format=json&limit=10000`
    const response = await fetch(url)
    const result = await response.json()

    if (!result.records) {
      toast("No market data found", 3000)
      return
    }

    // Market records may contain commodity variants; use includes for stable matching.
    const records = result.records.filter(item =>
      norm(item.commodity).includes(norm(crop)) &&
      norm(item.state) === norm(state)
    )

    if (records.length === 0) {
      toast("No matching market data", 3000)
      return
    }

    // Sort latest first
    records.sort((a, b) => parseDate(b.arrival_date) - parseDate(a.arrival_date))

    // Current date + 3 previous unique dates
    const uniqueByDate = new Map()
    for (const rec of records) {
      const dateKey = String(rec.arrival_date || '').trim()
      if (!dateKey) continue
      if (!uniqueByDate.has(dateKey)) uniqueByDate.set(dateKey, rec)
      if (uniqueByDate.size >= 4) break
    }

    const last4 = Array.from(uniqueByDate.values()).reverse()
    const labels = last4.map(r => r.arrival_date)
    const prices = last4.map(r => toNumber(r.modal_price))
    const msp = fixedMspByCrop[norm(crop)] ?? 0

    drawLiveMarketChart(labels, prices, msp)

  } catch (err) {
    console.error("Live market error:", err)
    toast("Error fetching live market data", 3000)
  }
}

function drawLiveMarketChart(labels, prices, msp) {

  const ctx = document.getElementById('liveMarketChart')
  if (!ctx) return

  if (liveMarketChart) liveMarketChart.destroy()

  const mspValue = Number(msp || 0)
  const mspLinePlugin = {
    id: 'mspLinePlugin',
    afterDatasetsDraw(chart) {
      const yScale = chart.scales.y
      if (!yScale) return

      const y = yScale.getPixelForValue(mspValue)
      const { left, right } = chart.chartArea
      const c = chart.ctx

      c.save()
      c.beginPath()
      c.setLineDash([6, 6])
      c.lineWidth = 3
      c.strokeStyle = '#ff6f00'
      c.moveTo(left, y)
      c.lineTo(right, y)
      c.stroke()
      c.restore()
    }
  }

  liveMarketChart = new Chart(ctx, {
    type: 'bar',
    plugins: [mspLinePlugin],
    data: {
      labels: labels,
      datasets: [
        {
          type: 'bar',
          label: 'Market Price',
          data: prices.map(p => Number(p || 0)),
          borderColor: '#2e7d32',
          backgroundColor: 'rgba(46,125,50,0.35)',
          borderWidth: 1
        },
        {
          type: 'line',
          label: 'MSP',
          data: new Array(labels.length).fill(mspValue),
          borderColor: '#ff6f00',
          backgroundColor: '#ff6f00',
          borderDash: [6,6],
          borderWidth: 2,
          pointRadius: 0
        }
      ]
    },
    options: {
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: false } }
    }
  })
}

//15DAYSFORECAST
async function load15DayPrediction(cropName, startDate) {
  try {

    let url = `http://127.0.0.1:5000/predict?crop=${encodeURIComponent(cropName)}&t=${new Date().getTime()}`
    if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Server error");
    }

    const data = await response.json();

    const labels = [];
    const prices = [];

    data.forEach(item => {
      labels.push(item.date);
      prices.push(item.predicted_price);
    });

    draw15DayChart(labels, prices);
    populateFifteenDayTable(data);

  } catch (error) {
    console.error("15-day prediction error:", error);
    toast("Unable to load 15-day prediction", 3000);
  }
}

function populateFifteenDayTable(data) {
  try {
    const tbody = document.getElementById('fifteenDayTableBody')
    if (!tbody) return
    tbody.innerHTML = ''

    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" style="padding:12px;color:#666;text-align:center">No prediction data</td></tr>'
      return
    }

    data.forEach(item => {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td style="padding:8px;border-bottom:1px solid #eee">${item.date}</td><td style="padding:8px;border-bottom:1px solid #eee">${item.predicted_price}</td>`
      tbody.appendChild(tr)
    })
  } catch(e) {
    console.error('Populate table error:', e)
  }
}

function draw15DayChart(labels, prices) {

  const ctx = document.getElementById('fifteenDayForecast');
  if (!ctx) return;

  if (fifteenChart) fifteenChart.destroy();

  fifteenChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '15-Day Price',
        data: prices,
        borderColor: '#2e7d32', // SAME THEME COLOR
        backgroundColor: 'rgba(46,125,50,0.06)', // SAME STYLE AS FIRST CHART
        tension: 0.4
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: false } }
    }
  });
}

function setCropSeedLoading(loading, errorText = '') {
  const loadingEl = document.getElementById('cropSeedLoading')
  const errorEl = document.getElementById('cropSeedError')
  const buttonEl = document.getElementById('cropSeedPredictBtn')
  if (loadingEl) loadingEl.style.display = loading ? 'inline' : 'none'
  if (errorEl) {
    errorEl.textContent = errorText
    errorEl.style.display = errorText ? 'inline' : 'none'
  }
  if (buttonEl) buttonEl.disabled = loading
}

function getCropSeedInputs() {
  const nitrogen = Number(document.getElementById('nitrogen')?.value)
  const phosphorus = Number(document.getElementById('phosphorus')?.value)
  const potassium = Number(document.getElementById('potassium')?.value)
  const crop = String(document.getElementById('seedCropSelect')?.value || 'Wheat').trim() || 'Wheat'

  return { nitrogen, phosphorus, potassium, crop }
}

function renderCropSuitability(items) {
  const suitDiv = document.getElementById('cropSuitability')
  if (!suitDiv) return
  if (!Array.isArray(items) || items.length === 0) {
    suitDiv.innerHTML = '<div class="muted">No crop suitability data available.</div>'
    return
  }

  let html = ''
  items.forEach(item => {
    const crop = String(item.crop || '').trim() || 'Unknown Crop'
    const pct = Math.max(0, Math.min(100, Number(item.percentage) || 0))
    html += `<div class="crop-suit-item">
      <div class="crop-suit-name"><span>${crop}</span><span>${pct}%</span></div>
      <div class="crop-suit-bar"><div class="crop-suit-fill" style="width:${pct}%"></div></div>
    </div>`
  })
  suitDiv.innerHTML = html
}

function renderSeedVarieties(items) {
  const seedDiv = document.getElementById('seedVarieties')
  if (!seedDiv) return
  if (!Array.isArray(items) || items.length === 0) {
    seedDiv.innerHTML = '<div class="muted">No seed recommendations available.</div>'
    return
  }

  let html = ''
  items.forEach(seed => {
    const name = String(seed.name || '').trim() || 'Unnamed Variety'
    const crop = String(seed.crop || '').trim()
    const season = String(seed.season || '').trim()
    const yieldType = String(seed.yield_type || '').trim() || 'Recommended'
    const subtitle = [crop, season].filter(Boolean).join(' - ')
    html += `<div class="seed-item">
      <div class="seed-name">${name}</div>
      <div class="seed-type">${subtitle || 'Crop/season details unavailable'}</div>
      <span class="seed-badge">${yieldType}</span>
    </div>`
  })
  seedDiv.innerHTML = html
}

function renderCropAdvice(advice) {
  const adviceDiv = document.getElementById('cropAdvice')
  if (!adviceDiv) return
  const text = String(advice || '').trim()
  adviceDiv.textContent = text || 'No agronomic advice available.'
}

async function handleCropPrediction(showValidationToast = true) {
  if (cropSeedRequestInFlight) return

  const payload = getCropSeedInputs()
  if (!Number.isFinite(payload.nitrogen) || !Number.isFinite(payload.phosphorus) || !Number.isFinite(payload.potassium)) {
    setCropSeedLoading(false, 'Please provide valid N, P, K values.')
    if (showValidationToast) toast('Enter valid N, P, K values', 2500)
    return
  }

  cropSeedRequestInFlight = true
  setCropSeedLoading(true, '')
  try {
    const response = await fetch(cropSeedApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        soil_data: {
          Nitrogen: payload.nitrogen,
          Phosphorus: payload.phosphorus,
          Potassium: payload.potassium
        },
        crop: payload.crop
      })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'AI request failed')

    renderCropSuitability(data.crop_suitability)
    renderSeedVarieties(data.recommended_seeds)
    renderCropAdvice(data.advice)
    setCropSeedLoading(false, '')
  } catch (error) {
    console.error('Crop/seed prediction error:', error)
    setCropSeedLoading(false, 'Unable to fetch AI recommendations right now.')
    renderCropSuitability([])
    renderSeedVarieties([])
    renderCropAdvice('Unable to generate advice at this time. Please try again.')
    toast('Crop & Seed recommendation failed', 3000)
  } finally {
    cropSeedRequestInFlight = false
  }
}

function initRiskChart() {
  try {
    const ctx = document.getElementById('riskChart')
    if (!ctx) return
    
    if (riskChart) riskChart.destroy()
    
    riskChart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Aphids', 'Rot', 'Rust', 'Mites', 'Wilt', 'Blight'],
        datasets: [{
          label: 'Risk Level',
          data: [65, 45, 72, 38, 52, 40],
          borderColor: '#ff6f00',
          backgroundColor: 'rgba(255, 111, 0, 0.15)',
          borderWidth: 2,
          pointBackgroundColor: '#ff6f00'
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: { stepSize: 20 }
          }
        }
      }
    })
  } catch(e) {
    console.error('Risk chart error:', e)
  }
}

function initNutrientChart() {
  try {
    const ctx = document.getElementById('nutrientChart')
    if (!ctx) return
    
    if (nutrientChart) nutrientChart.destroy()
    
    nutrientChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Seedling', 'Vegetative', 'Flowering', 'Filling', 'Harvest'],
        datasets: [
          { label: 'N', data: [40, 75, 55, 35, 20], backgroundColor: '#2ecc71' },
          { label: 'P', data: [35, 45, 60, 50, 25], backgroundColor: '#f1c40f' },
          { label: 'K', data: [38, 50, 48, 65, 45], backgroundColor: '#3498db' }
        ]
      },
      options: {
        indexAxis: 'x',
        scales: { x: { stacked: false }, y: { stacked: false } },
        plugins: { legend: { position: 'bottom' } }
      }
    })
  } catch(e) {
    console.error('Nutrient chart error:', e)
  }
}

function populateStaticSections() {
  try {
    renderCropSuitability([])
    renderSeedVarieties([])
    renderCropAdvice('Enter NPK values, then run prediction.')

    // Populate prevention suggestions
    const prevDiv = document.getElementById('preventionSuggestions')
    if (prevDiv) {
      let html = ''
      riskData.wheat.prevention.forEach(item => {
        const className = item.risk === 'High' ? 'prevention-high' : 'prevention-medium'
        html += `<div class="prevention-item ${className}">
          <strong>${item.risk}: ${item.issue}</strong><br><span class="muted">${item.action}</span>
        </div>`
      })
      prevDiv.innerHTML = html
    }

    // Populate chemical guidance
    const chemDiv = document.getElementById('chemicalGuidance')
    if (chemDiv) {
      let html = ''
      riskData.wheat.chemicals.forEach(chem => {
        html += `<div>- ${chem}</div>`
      })
      chemDiv.innerHTML = html
    }

    // Populate fertilizer efficiency
    const fertDiv = document.getElementById('fertilizerEfficiency')
    if (fertDiv) {
      const effs = { Urea: 78, DAP: 85, MOP: 62 }
      let html = ''
      for (let [name, pct] of Object.entries(effs)) {
        html += `<div class="fert-item">
          <div class="fert-name">${name}</div>
          <div class="fert-bar"><div class="fert-fill" style="width:${pct}%"></div></div>
          <div class="fert-percent">${pct}%</div>
        </div>`
      }
      fertDiv.innerHTML = html
    }
  } catch(e) {
    console.error('Populate error:', e)
  }
}

function bindCropSeedEvents() {
  const predictBtn = document.getElementById('cropSeedPredictBtn')
  if (predictBtn) {
    predictBtn.addEventListener('click', () => handleCropPrediction(true))
  }
}

function runPrediction(){
  try {
    const crop = document.getElementById('cropSelect')?.value
    const location = document.getElementById('locSelect')?.value
    const date = document.getElementById('harvestDate')?.value
    
    if(!crop) { toast('Please select a crop', 3000); return }
    if(!location) { toast('Please select a location', 3000); return }
    if(!date) { toast('Please select a harvest date', 3000); return }
    
    if(!fifteenChart) { 
      toast('Charts not initialized', 3000); 
      return 
    }

    // Fetch live market data
    fetchLiveMarketPrice(crop, location);

    // Load 15-day prediction
    load15DayPrediction(crop, date);
    handleCropPrediction(false)

    toast('Prediction complete for ' + crop)

  } catch(e) {
    console.error('Prediction error:', e)
    toast('Failed to run prediction', 3000)
  }
}

function savePrediction(){
  try {
    const crop = document.getElementById('cropSelect')?.value
    const date = document.getElementById('harvestDate')?.value
    if(!crop) { toast('Select a crop first', 3000); return }
    const list = JSON.parse(localStorage.getItem('savedPredictions')||'[]')
    list.push({crop, date: date || new Date().toISOString().slice(0,10), ts: Date.now()})
    localStorage.setItem('savedPredictions', JSON.stringify(list))
    toast('Prediction saved')
  } catch(e) {
    console.error('Save prediction error:', e)
    toast('Failed to save prediction', 3000)
  }
}

document.addEventListener('DOMContentLoaded', initCharts)


