import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
import RatingWorkbench from './RatingWorkbench'
import ReviewWorkbench from './ReviewWorkbench'
import './index.css'

const PairwiseEvaluationWorkbench = lazy(() => import('./PairwiseEvaluationWorkbench'))
const workflow = new URLSearchParams(window.location.search).get('workflow')
const reviewMode = workflow === 'review'
const pairwiseMode = workflow !== 'evaluation' && !reviewMode
document.title = reviewMode ? 'PReBi · Feedbackprüfung' : pairwiseMode ? 'PReBi · Expertenevaluation' : 'PReBi · Expertenbewertung'
createRoot(document.getElementById('root')!).render(reviewMode ? <ReviewWorkbench /> : pairwiseMode
  ? <Suspense fallback={<main className="evaluation-start"><p className="start-description">Expertenevaluation wird geladen …</p></main>}><PairwiseEvaluationWorkbench /></Suspense>
  : <RatingWorkbench />)