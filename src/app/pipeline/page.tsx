import AppLayout from '@/components/layout/AppLayout';
import PipelineBoard from '@/components/pipeline/PipelineBoard';

// La page ne fait AUCUNE lecture en base : le tableau charge lui-même les
// affaires du pipeline sélectionné (mémorisé dans le navigateur) via
// GET /api/deals. Un rendu serveur ne pourrait de toute façon pas deviner ce
// pipeline, et la navigation resterait bloquée le temps de la requête —
// c'est ce qui rendait l'onglet « Pipeline » si lent à ouvrir.
export default function PipelinePage() {
  return (
    <AppLayout>
      <div style={{ height: '100%' }}>
        <PipelineBoard />
      </div>
    </AppLayout>
  );
}
