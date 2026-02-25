function getTheme() {
  return document.documentElement.dataset.theme || 'dark'
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('theme', theme)
  } catch (e) {
    // ignore
  }
  renderThemeToggle()
}

function renderThemeToggle() {
  const theme = getTheme()
  const icon = document.getElementById('themeIcon')
  const label = document.getElementById('themeLabel')

  if (!icon || !label) return

  if (theme === 'dark') {
    icon.textContent = '🌙'
    label.textContent = 'Dark'
  } else {
    icon.textContent = '☀️'
    label.textContent = 'Light'
  }
}

function nowString() {
  try {
    return new Date().toLocaleString()
  } catch {
    return new Date().toISOString()
  }
}

function summary(inputs) {
  const parts = [
    `SM ${inputs.social_media_hours}h`,
    `Gaming ${inputs.gaming_hours}h`,
    `Work ${inputs.online_work_hours}h`,
    `Activity ${inputs.physical_activity_hours}h`,
    `Age ${inputs.age}`,
  ]
  return parts.join(' · ')
}

function pillClass(category) {
  const c = String(category || '').toLowerCase()
  if (c.includes('poor')) return 'pill-cat pill-cat--poor'
  if (c.includes('normal')) return 'pill-cat pill-cat--normal'
  if (c.includes('good')) return 'pill-cat pill-cat--good'
  return 'pill-cat'
}

// --- Charts state ---
let barChart = null
let lineChart = null
let pieChart = null

const chartHistoryLabels = []
const chartHistoryHours = []
const chartCategoryCounts = {
  'Poor Sleep': 0,
  'Normal Sleep': 0,
  'Good Sleep': 0,
}

function validateField(input) {
  const field = input.closest('.field')
  const err = field.querySelector('.field__error')

  const value = input.value

  const isRequired = input.hasAttribute('required')
  const min = input.getAttribute('min')
  const max = input.getAttribute('max')

  let message = ''

  if (isRequired && (value === '' || value === null || value === undefined)) {
    message = 'Required'
  } else if (value !== '') {
    const n = Number(value)
    if (!Number.isFinite(n)) message = 'Enter a valid number'
    if (min !== null && n < Number(min)) message = `Must be ≥ ${min}`
    if (max !== null && n > Number(max)) message = `Must be ≤ ${max}`
  }

  if (message) {
    field.classList.add('field--error')
    err.textContent = message
    return false
  }

  field.classList.remove('field--error')
  err.textContent = ''
  return true
}

async function predict(payload) {
  const res = await fetch('/api/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed (${res.status})`)
  }

  return res.json()
}

function setLoading(loading) {
  const btn = document.getElementById('predictBtn')
  const spinner = document.getElementById('spinner')
  const txt = document.getElementById('predictBtnText')

  btn.disabled = loading
  spinner.hidden = !loading
  txt.textContent = loading ? 'Predicting...' : 'Predict My Sleep'
}

function setApiError(message) {
  const el = document.getElementById('apiError')
  if (!message) {
    el.hidden = true
    el.textContent = ''
    return
  }
  el.hidden = false
  el.textContent = message
}

function showResults(result) {
  document.getElementById('resultsEmpty').hidden = true
  document.getElementById('results').hidden = false

  const hours = Number(result.predicted_sleep_hours)
  document.getElementById('predHours').textContent = Number.isFinite(hours)
    ? `${hours.toFixed(1)} hours`
    : '—'

  document.getElementById('predCategory').textContent = result.sleep_category || '—'
  document.getElementById('predRec').textContent = result.recommendation || 'Recommendation placeholder.'

  const pill = document.getElementById('catPill')
  pill.className = pillClass(result.sleep_category)
  pill.textContent = result.sleep_category || '—'
}

function initCharts() {
  if (typeof Chart === 'undefined') return

  const barEl = document.getElementById('chartScreenSleep')
  const lineEl = document.getElementById('chartTrend')
  const pieEl = document.getElementById('chartCategory')

  if (barEl && !barChart) {
    barChart = new Chart(barEl.getContext('2d'), {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Total screen time (h)',
            data: [],
            backgroundColor: 'rgba(96, 165, 250, 0.8)',
          },
          {
            label: 'Predicted sleep (h)',
            data: [],
            backgroundColor: 'rgba(52, 211, 153, 0.8)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#e5e7eb' } },
          y: { ticks: { color: '#e5e7eb' }, beginAtZero: true },
        },
        plugins: {
          legend: { labels: { color: '#e5e7eb' } },
        },
      },
    })
  }

  if (lineEl && !lineChart) {
    lineChart = new Chart(lineEl.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Predicted sleep (h)',
            data: [],
            borderColor: 'rgba(129, 140, 248, 1)',
            backgroundColor: 'rgba(129, 140, 248, 0.2)',
            tension: 0.3,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#e5e7eb' } },
          y: { ticks: { color: '#e5e7eb' }, beginAtZero: true },
        },
        plugins: {
          legend: { labels: { color: '#e5e7eb' } },
        },
      },
    })
  }

  if (pieEl && !pieChart) {
    pieChart = new Chart(pieEl.getContext('2d'), {
      type: 'pie',
      data: {
        labels: ['Poor Sleep', 'Normal Sleep', 'Good Sleep'],
        datasets: [
          {
            data: [0, 0, 0],
            backgroundColor: [
              'rgba(248, 113, 113, 0.9)',
              'rgba(250, 204, 21, 0.9)',
              'rgba(52, 211, 153, 0.9)',
            ],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#e5e7eb' } },
        },
      },
    })
  }
}

function updateCharts(inputs, result) {
  const hours = Number(result.predicted_sleep_hours)
  if (!Number.isFinite(hours)) return

  const label = nowString()
  const totalScreen =
    Number(inputs.social_media_hours || 0) +
    Number(inputs.gaming_hours || 0) +
    Number(inputs.online_work_hours || 0)

  chartHistoryLabels.push(label)
  chartHistoryHours.push(hours)

  // keep last 7 points
  const maxPoints = 7
  const labels = chartHistoryLabels.slice(-maxPoints)
  const hoursData = chartHistoryHours.slice(-maxPoints)

  if (barChart) {
    barChart.data.labels = labels
    barChart.data.datasets[0].data = labels.map(() => totalScreen)
    barChart.data.datasets[1].data = hoursData
    barChart.update()
  }

  if (lineChart) {
    lineChart.data.labels = labels
    lineChart.data.datasets[0].data = hoursData
    lineChart.update()
  }

  const cat = result.sleep_category || 'Normal Sleep'
  if (cat in chartCategoryCounts) {
    chartCategoryCounts[cat] += 1
  }

  if (pieChart) {
    pieChart.data.datasets[0].data = [
      chartCategoryCounts['Poor Sleep'],
      chartCategoryCounts['Normal Sleep'],
      chartCategoryCounts['Good Sleep'],
    ]
    pieChart.update()
  }
}

function addHistoryRow(inputs, result) {
  const body = document.getElementById('historyBody')
  const count = document.getElementById('historyCount')

  const row = document.createElement('tr')
  const hours = Number(result.predicted_sleep_hours)

  row.innerHTML = `
    <td>${nowString()}</td>
    <td>${summary(inputs)}</td>
    <td>${Number.isFinite(hours) ? hours.toFixed(1) : '—'}</td>
    <td>${result.sleep_category || '—'}</td>
  `.trim()

  if (body.querySelector('.table__empty')) {
    body.innerHTML = ''
  }

  body.prepend(row)
  count.textContent = String(body.querySelectorAll('tr').length)

  updateCharts(inputs, result)
}

function init() {
  document.getElementById('year').textContent = String(new Date().getFullYear())

  renderThemeToggle()
  document.getElementById('themeToggle').addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark')
  })

  initCharts()

  const form = document.getElementById('predictForm')
  const inputs = Array.from(form.querySelectorAll('input'))

  inputs.forEach((i) => {
    i.addEventListener('blur', () => validateField(i))
    i.addEventListener('input', () => {
      const field = i.closest('.field')
      if (field.classList.contains('field--error')) validateField(i)
    })
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    setApiError('')

    let ok = true
    for (const i of inputs) {
      if (!validateField(i)) ok = false
    }
    if (!ok) return

    const data = new FormData(form)

    const payload = {
      social_media_hours: Number(data.get('social_media_hours')),
      gaming_hours: Number(data.get('gaming_hours')),
      online_work_hours: Number(data.get('online_work_hours')),
      physical_activity_hours: Number(data.get('physical_activity_hours')),
      age: Number(data.get('age')),
    }

    const caffeine = data.get('caffeine_intake')
    const stb = data.get('screen_time_before_bed')

    if (caffeine !== null && String(caffeine).trim() !== '') payload.caffeine_intake = Number(caffeine)
    if (stb !== null && String(stb).trim() !== '') payload.screen_time_before_bed = Number(stb)

    setLoading(true)

    try {
      const result = await predict(payload)
      showResults(result)
      addHistoryRow(payload, result)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Prediction failed')
    } finally {
      setLoading(false)
    }
  })
}

document.addEventListener('DOMContentLoaded', init)
