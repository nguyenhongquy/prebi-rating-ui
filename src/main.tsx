import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
import RatingWorkbench from './RatingWorkbench'
import ReviewWorkbench from './ReviewWorkbench'
import './index.css'

const PairwiseEvaluationWorkbench = lazy(() => import('./PairwiseEvaluationWorkbench'))
const LecturerWorkbench = lazy(() => import('./LecturerWorkbench'))
const workflow = new URLSearchParams(window.location.search).get('workflow')
const lecturerMode = workflow === 'lecturer'
const lecturerApiMode = lecturerMode && new URLSearchParams(window.location.search).get('source') === 'api'
const reviewMode = workflow === 'review'
const pairwiseMode = workflow !== 'evaluation' && !reviewMode
document.title = lecturerMode ? lecturerApiMode ? 'PReBi · Lokale API-Integration' : 'PReBi · Dozierenden-Demo' : reviewMode ? 'PReBi · Feedbackprüfung' : pairwiseMode ? 'PReBi · Expertenevaluation' : 'PReBi · Expertenbewertung'
createRoot(document.getElementById('root')!).render(lecturerMode ? <Suspense fallback={<main><p role="status">Dozierenden-Workflow wird geladen …</p></main>}><LecturerWorkbench apiMode={lecturerApiMode} /></Suspense> : reviewMode ? <ReviewWorkbench /> : pairwiseMode
  ? <Suspense fallback={<main className="evaluation-start"><p className="start-description">Expertenevaluation wird geladen …</p></main>}><PairwiseEvaluationWorkbench /></Suspense>
  : <RatingWorkbench />)