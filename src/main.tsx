import { createRoot } from 'react-dom/client'
import RatingWorkbench from './RatingWorkbench'
import ReviewWorkbench from './ReviewWorkbench'
import './index.css'

const reviewMode = new URLSearchParams(window.location.search).get('workflow') === 'review'
document.title = reviewMode ? 'PReBi · Lecturer review' : 'PReBi · Expert evaluation'
createRoot(document.getElementById('root')!).render(reviewMode ? <ReviewWorkbench /> : <RatingWorkbench />)