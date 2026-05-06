require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.static(path.join(__dirname, 'public')));

const ZEPHYR_BASE = process.env.ZEPHYR_BASE_URL;
const ZEPHYR_TOKEN = process.env.ZEPHYR_API_TOKEN;
const JIRA_BASE = process.env.JIRA_BASE_URL;
const JIRA_AUTH = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
const PROJECTS = ['NXMN', 'CTP', 'RMSS', 'KGU', 'DGL', 'JM', 'RCEP', 'PRGM'];

async function zephyrCount(project, startDate, endDate) {
  try {
    const { data: first } = await axios.get(`${ZEPHYR_BASE}/testcases`, {
      headers: { Authorization: `Bearer ${ZEPHYR_TOKEN}` },
      params: { projectKey: project, maxResults: 1 }, timeout: 10000
    });
    if (!first.total) return 0;
    const startAt = Math.max(0, first.total - 1000);
    const { data } = await axios.get(`${ZEPHYR_BASE}/testcases`, {
      headers: { Authorization: `Bearer ${ZEPHYR_TOKEN}` },
      params: { projectKey: project, maxResults: 1000, startAt }, timeout: 15000
    });
    return data.values.filter(v => {
      const d = (v.createdOn || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    }).length;
  } catch { return 0; }
}

async function jiraCount(jql) {
  try {
    const { data } = await axios.get(`${JIRA_BASE}/rest/api/3/search`, {
      headers: { Authorization: `Basic ${JIRA_AUTH}` },
      params: { jql, maxResults: 0 }, timeout: 10000
    });
    return data.total;
  } catch { return 0; }
}

app.get('/api/metrics', async (req, res) => {
  const month = req.query.month || '2026-04';
  const [year, mon] = month.split('-');
  const lastDay = new Date(parseInt(year), parseInt(mon), 0).getDate();
  const start = `${month}-01`;
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  const adoptionDay = parseInt(process.env.AI_ADOPTION_DAY || '16') - 1;
  const mid = `${year}-${mon}-${String(adoptionDay).padStart(2, '0')}`;

  try {
    const [tcCounts, defectTotal, defectExternal] = await Promise.all([
      Promise.all(PROJECTS.map(p => Promise.all([
        zephyrCount(p, start, end),
        zephyrCount(p, start, mid)
      ]))),
      jiraCount(`issuetype = Bug AND created >= "${start}" AND created <= "${end}"`),
      jiraCount(`issuetype = Bug AND created >= "${start}" AND created <= "${end}" AND project = PRDS`)
    ]);

    let tcTotal = 0, tcManual = 0;
    tcCounts.forEach(([t, m]) => { tcTotal += t; tcManual += m; });

    const autoNew = parseInt(process.env.AUTO_NEW_TCS || '53');
    const autoCases = parseInt(process.env.AUTO_TOTAL_CASES || '852');
    const autoMult = parseInt(process.env.AUTO_MULTIPLIER || '12');

    res.json({
      month, fetchedAt: new Date().toISOString(),
      metrics: {
        tcTotal, tcAI: tcTotal - tcManual, tcManual,
        defectTotal, defectInternal: defectTotal - defectExternal, defectExternal,
        autoNew, autoTotal: autoCases * autoMult, autoFormula: `${autoCases} × ${autoMult}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () =>
  console.log(`QA KPI Dashboard → http://127.0.0.1:${PORT}`)
);
