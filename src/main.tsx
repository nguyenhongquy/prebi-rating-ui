import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
import RatingWorkbench from './RatingWorkbench'
import ReviewWorkbench from './ReviewWorkbench'
import './index.css'

const PairwiseEvaluationWorkbench = lazy(() => import('./PairwiseEvaluationWorkbench'))
const LecturerWorkbench = lazy(() => import('./LecturerWorkbench'))
const G1Workbench = lazy(() => import('./G1Workbench'))
const workflow = new URLSearchParams(window.location.search).get('workflow')
const g1Mode = workflow === 'g1'
const lecturerMode = workflow === 'lecturer'
const lecturerApiMode = lecturerMode && new URLSearchParams(window.location.search).get('source') === 'api'
const reviewMode = workflow === 'review'
const pairwiseMode = workflow !== 'evaluation' && !reviewMode
document.title = g1Mode ? 'PReBi · G1 Feedback' : lecturerMode ? lecturerApiMode ? 'PReBi · Lokale API-Integration' : 'PReBi · Dozierenden-Demo' : reviewMode ? 'PReBi · Feedbackprüfung' : pairwiseMode ? 'PReBi · Expertenevaluation' : 'PReBi · Expertenbewertung'
createRoot(document.getElementById('root')!).render(g1Mode ? <Suspense fallback={<main><p role="status">G1-Workflow wird geladen …</p></main>}><G1Workbench /></Suspense> : lecturerMode ? <Suspense fallback={<main><p role="status">Dozierenden-Workflow wird geladen …</p></main>}><LecturerWorkbench apiMode={lecturerApiMode} /></Suspense> : reviewMode ? <ReviewWorkbench /> : pairwiseMode
  ? <Suspense fallback={<main className="evaluation-start"><p className="start-description">Expertenevaluation wird geladen …</p></main>}><PairwiseEvaluationWorkbench /></Suspense>
  : <RatingWorkbench />)