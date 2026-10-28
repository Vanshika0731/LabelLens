(() => {
  const $ = id => document.getElementById(id);
  const fileInput = $('fileInput'), dropZone = $('dropZone'), previewImg = $('previewImg');
  let selectedFile = null, currentReport = null, activeFilter = 'all';
  const historyKey = 'labellens_scan_history_v1';

  function labelFrom(item) {
    const raw = `${item.label || ''} ${item.status || ''}`.toLowerCase();
    if (/\bred\b|harmful|high concern/.test(raw)) return 'Red';
    if (/\borange\b|caution/.test(raw)) return 'Orange';
    if (/\byellow\b|moderate/.test(raw)) return 'Yellow';
    if (/\bgreen\b|safe \(model label/.test(raw)) return 'Green';
    return 'Unknown';
  }
  const levelClass = label => ({Green:'green',Yellow:'yellow',Orange:'orange',Red:'red',Unknown:'unknown'}[label] || 'unknown');
  function setError(message) { $('errorBox').textContent = message || ''; $('errorBox').hidden = !message; }
  function selectFile(file) {
    setError('');
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError('Please choose a JPG, PNG, or WEBP image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Image is larger than 5 MB. Please choose a smaller image.'); return; }
    selectedFile = file;
    const url = URL.createObjectURL(file);
    previewImg.src = url; previewImg.hidden = false;
    document.querySelector('.preview-empty').hidden = true;
    $('analyzeBtn').disabled = false;
  }
  function clearImage() {
    if (previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);
    selectedFile = null; fileInput.value = ''; previewImg.removeAttribute('src'); previewImg.hidden = true;
    document.querySelector('.preview-empty').hidden = false; $('analyzeBtn').disabled = true; setError('');
  }
  $('browseBtn').addEventListener('click', e => { e.stopPropagation(); fileInput.removeAttribute('capture'); fileInput.click(); });
  $('cameraBtn').addEventListener('click', e => { e.stopPropagation(); fileInput.setAttribute('capture','environment'); fileInput.click(); });
  dropZone.addEventListener('click', e => { if (!e.target.closest('button')) fileInput.click(); });
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));
  $('clearBtn').addEventListener('click', clearImage);
  ['dragenter','dragover'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', e => selectFile(e.dataTransfer.files[0]));
  $('themeBtn').addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('labellens_theme', document.body.classList.contains('dark') ? 'dark' : 'light'); });
  if (localStorage.getItem('labellens_theme') === 'dark') document.body.classList.add('dark');

  function showLoading(on) { $('loadingResults').hidden = !on; $('emptyResults').hidden = on || !!currentReport; $('resultsContent').hidden = on || !currentReport; $('analyzeBtn').disabled = on || !selectedFile; $('resultState').textContent = on ? 'ANALYZING' : (currentReport ? 'COMPLETE' : 'WAITING'); }
  $('analyzeBtn').addEventListener('click', async () => {
    if (!selectedFile) return;
    const name = $('productName').value.trim(); setError(''); showLoading(true);
    const data = new FormData(); data.append('image', selectedFile, selectedFile.name);
    try {
      const response = await fetch('/analyze', {method:'POST', body:data});
      let payload; try { payload = await response.json(); } catch { throw new Error('The server returned an unreadable response. Check that Flask is running.'); }
      if (!response.ok) throw new Error(payload.error || payload.message || `Analysis failed (${response.status}).`);
      if (!Array.isArray(payload.ingredients)) throw new Error('The API response did not include an ingredients list. Check the /analyze response format.');
      currentReport = {...payload, product_name:name || 'Scanned product', scanned_at:new Date().toISOString()};
      renderReport(currentReport); saveHistory(currentReport); renderHistory();
      $('results').scrollIntoView({behavior:'smooth',block:'start'});
    } catch (error) {
      setError(error.message || 'Could not analyze the image. Please try again.');
    } finally { showLoading(false); }
  });
  function renderReport(report) {
    $('emptyResults').hidden = true; $('resultsContent').hidden = false;
    $('resultProductName').textContent = report.product_name || 'Scanned product';
    $('resultSummary').textContent = `${report.ingredients.length} ingredient entries detected`;
    $('resultThumb').textContent = '🥫';
    const score = Number(report.score);
    $('scoreValue').textContent = Number.isFinite(score) ? `${Math.round(score * (score <= 1 ? 100 : 1))}%` : '—';
    $('scoreBar').style.width = Number.isFinite(score) ? `${Math.max(0,Math.min(100,score <= 1 ? score*100 : score))}%` : '0%';
    $('overallStatus').textContent = report.overall_status || 'Review ingredient details';
    $('recommendationText').textContent = report.recommendation || 'Verify the extracted ingredient names against the original package.';
    const labels = report.ingredients.map(labelFrom); const counts = {Green:0,Yellow:0,Orange:0,Red:0};
    labels.forEach(label => { if (counts[label] !== undefined) counts[label]++; });
    Object.entries({Green:'greenCount',Yellow:'yellowCount',Orange:'orangeCount',Red:'redCount'}).forEach(([label,id]) => $(id).textContent = counts[label]);
    const dominant = labels.includes('Red') ? 'Red' : labels.includes('Orange') ? 'Orange' : labels.includes('Yellow') ? 'Yellow' : labels.length && labels.every(x=>x==='Green') ? 'Green' : 'Unknown';
    $('overallCard').className = `overall-card ${levelClass(dominant)}`; $('overallIcon').textContent = dominant==='Red'?'!':dominant==='Orange'?'!':dominant==='Yellow'?'•':'✓';
    $('itemCount').textContent = `${report.ingredients.length} ingredient${report.ingredients.length===1?'':'s'} found`;
    renderIngredients();
  }
  function renderIngredients() {
    if (!currentReport) return;
    const query = $('ingredientSearch').value.trim().toLowerCase();
    const list = currentReport.ingredients.map(item => ({...item, _label:labelFrom(item)})).filter(item => {
      const match = `${item.name||''} ${item.reason||''} ${item.status||''}`.toLowerCase().includes(query);
      const filter = activeFilter==='all' || (activeFilter==='negative' && ['Red','Orange','Yellow','Unknown'].includes(item._label)) || (activeFilter==='positive' && item._label==='Green');
      return match && filter;
    });
    $('ingredientList').replaceChildren(); $('noIngredients').hidden = list.length > 0;
    list.forEach(item => {
      const article = document.createElement('article'); article.className = 'ingredient-item';
      const details = document.createElement('div'); const title = document.createElement('h4'); title.textContent = item.name || 'Unidentified ingredient';
      const reason = document.createElement('p'); reason.textContent = item.reason || item.status || 'No explanation was provided by the API.';
      const badge = document.createElement('span'); badge.className = `level ${levelClass(item._label)}`; badge.textContent = item._label === 'Unknown' ? 'Review' : item._label;
      details.append(title, reason); article.append(details,badge); $('ingredientList').append(article);
    });
  }
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll('.tab').forEach(tab => { const active = tab===button; tab.classList.toggle('active',active); tab.setAttribute('aria-selected',String(active)); }); renderIngredients();
  }));
  $('ingredientSearch').addEventListener('input', renderIngredients);
  function getHistory() { try { return JSON.parse(localStorage.getItem(historyKey) || '[]'); } catch { return []; } }
  function saveHistory(report) {
    const history = getHistory(); history.unshift({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:report.product_name,date:report.scanned_at,overall:report.overall_status,count:report.ingredients.length,report});
    try { localStorage.setItem(historyKey, JSON.stringify(history.slice(0,12))); } catch { /* Browser storage may be full; current result still works. */ }
  }
  function renderHistory() {
    const host = $('historyList'), history = getHistory(); host.replaceChildren();
    if (!history.length) { const empty=document.createElement('div'); empty.className='history-empty'; empty.textContent='No scans yet. Your completed scans will show up here.'; host.append(empty); return; }
    history.forEach(item => {
      const card=document.createElement('article');card.className='history-card';const icon=document.createElement('div');icon.className='history-icon';icon.textContent='🥫';
      const content=document.createElement('div');const title=document.createElement('b');title.textContent=item.name||'Scanned product';const meta=document.createElement('small');meta.textContent=`${item.count} ingredients · ${new Date(item.date).toLocaleDateString()}`;content.append(title,meta);
      const open=document.createElement('button');open.textContent='View';open.addEventListener('click',()=>{currentReport=item.report;renderReport(currentReport);$('results').scrollIntoView({behavior:'smooth'});});card.append(icon,content,open);host.append(card);
    });
  }
  $('clearHistoryBtn').addEventListener('click',()=>{if(confirm('Clear scan history stored in this browser?')){localStorage.removeItem(historyKey);renderHistory();}});
  function downloadReport() {
    if (!currentReport) return; const blob=new Blob([JSON.stringify(currentReport,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='labellens-report.json';a.click();URL.revokeObjectURL(url);
  }
  $('downloadBtn').addEventListener('click',downloadReport);
  $('shareBtn').addEventListener('click',async()=>{if(!currentReport)return;const text=`LabelLens — ${currentReport.product_name}\n${currentReport.overall_status}\nIngredients detected: ${currentReport.ingredients.length}\n${currentReport.recommendation||''}\nModel estimate only; verify the package label.`;try{if(navigator.share)await navigator.share({title:'LabelLens scan',text});else if(navigator.clipboard){await navigator.clipboard.writeText(text);alert('Summary copied to clipboard.');}else{downloadReport();}}catch(e){if(e.name!=='AbortError')setError('Sharing is unavailable in this browser. You can download the report instead.');}});
  renderHistory();
})();
