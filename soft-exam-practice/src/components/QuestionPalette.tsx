import type { Question } from '../types/exam';

interface QuestionPaletteProps {
  questions: Question[];
  currentIndex: number;
  answers: Record<string, string>;
  marked: Set<string>;
  onSelect: (index: number) => void;
}

export function QuestionPalette({ questions, currentIndex, answers, marked, onSelect }: QuestionPaletteProps) {
  return (
    <aside className="question-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">QUESTION PALETTE</span>
          <h2>答题卡</h2>
        </div>
        <span className="panel-count">{questions.length} 题</span>
      </div>
      <div className="palette-legend">
        <span><i className="legend-dot answered" />已答</span>
        <span><i className="legend-dot marked" />标记</span>
        <span><i className="legend-dot empty" />未答</span>
      </div>
      <div className="palette-grid">
        {questions.map((question, index) => {
          const isAnswered = Boolean(answers[question.id]);
          const isMarked = marked.has(question.id);
          return (
            <button
              className={`palette-button ${isAnswered ? 'is-answered' : ''} ${isMarked ? 'is-marked' : ''} ${index === currentIndex ? 'is-current' : ''}`}
              key={question.id}
              type="button"
              onClick={() => onSelect(index)}
            >
              {question.number}
            </button>
          );
        })}
      </div>
      <div className="palette-summary">
        <span>已答 <strong>{Object.keys(answers).length}</strong></span>
        <span>待检查 <strong>{marked.size}</strong></span>
        <span>未答 <strong>{questions.length - Object.keys(answers).length}</strong></span>
      </div>
    </aside>
  );
}
