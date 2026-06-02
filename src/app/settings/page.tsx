const fetchAll = useCallback(async () => {
  const [bRes, pRes, collRes, tRes] = await Promise.all([
    fetch('/api/brands'),
    fetch('/api/pipelines'),
    fetch('/api/collaborators'),
    fetch('/api/email-templates'),
  ]);
  if (bRes.ok) setBrands(await bRes.json());
  if (pRes.ok) {
    const pData = await pRes.json();
    setPipelines(pData.pipelines || []);
    if (pData.pipelines && pData.pipelines.length > 0) {
      setSelectedPipelineId(pData.pipelines[0].id);
    }
  }
  if (collRes.ok) setCollaborators(await collRes.json());
  if (tRes.ok) setTemplates(await tRes.json());
}, []);  // ✅ CORRECT — empty array
