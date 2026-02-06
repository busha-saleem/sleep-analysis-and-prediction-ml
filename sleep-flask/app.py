import os
from dataclasses import dataclass

import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.preprocessing import StandardScaler

app = Flask(__name__, static_folder='static', template_folder='templates')


FEATURES = [
    'social_media_hours',
    'gaming_hours',
    'online_work_hours',
    'total_screen_time',
    'physical_activity_hours',
    'caffeine_intake',
    'screen_time_before_bed',
    'age',
    'activity_ratio',
    'caffeine_effect',
]


@dataclass
class ModelBundle:
    lr: LinearRegression
    scaler: StandardScaler
    knn: KNeighborsClassifier
    defaults: dict


_BUNDLE: ModelBundle | None = None


def _categorize_sleep(hours: float) -> int:
    if hours < 6:
        return 0
    if hours <= 7:
        return 1
    return 2


def _num_to_label(num: int) -> str:
    return {0: 'Poor Sleep', 1: 'Normal Sleep', 2: 'Good Sleep'}.get(int(num), 'Normal Sleep')


def _recommendation_for(label: str) -> str:
    if label == 'Poor Sleep':
        return 'Try reducing late-night screen time, limit caffeine in the evening, and add light physical activity.'
    if label == 'Good Sleep':
        return 'Great job—keep your routine consistent and maintain a balanced mix of activity and screen time.'
    return 'Aim for consistent bed/wake times and moderate screen time before sleep for better recovery.'


def _get_dataset_path() -> str:
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    return os.path.join(base, 'sleep_dataset.csv')


def _train_models() -> ModelBundle:
    df = pd.read_csv(_get_dataset_path())

    df['total_screen_time'] = df['social_media_hours'] + df['gaming_hours'] + df['online_work_hours']
    df['activity_ratio'] = df['physical_activity_hours'] / (df['total_screen_time'] + 0.1)
    df['caffeine_effect'] = df['caffeine_intake'] * df['screen_time_before_bed']

    X = df[FEATURES]
    y_reg = df['sleep_hours']
    y_clf = df['sleep_hours'].apply(_categorize_sleep)

    X_train, _, y_train_reg, _ = train_test_split(X, y_reg, test_size=0.3, random_state=42)
    X_train_c, _, y_train_clf, _ = train_test_split(
        X, y_clf, test_size=0.3, random_state=42, stratify=y_clf
    )

    lr = LinearRegression()
    lr.fit(X_train, y_train_reg)

    scaler = StandardScaler()
    X_train_c_scaled = scaler.fit_transform(X_train_c)

    knn = KNeighborsClassifier(n_neighbors=5, metric='manhattan', weights='uniform')
    knn.fit(X_train_c_scaled, y_train_clf)

    defaults = {
        'caffeine_intake': float(df['caffeine_intake'].mean()),
        'screen_time_before_bed': float(df['screen_time_before_bed'].mean()),
    }

    return ModelBundle(lr=lr, scaler=scaler, knn=knn, defaults=defaults)


def get_bundle() -> ModelBundle:
    global _BUNDLE
    if _BUNDLE is None:
        _BUNDLE = _train_models()
    return _BUNDLE


def _as_float(value, field: str) -> float:
    try:
        return float(value)
    except Exception as e:
        raise ValueError(f'Invalid value for {field}') from e


@app.get('/')
def index():
    bundle = get_bundle()
    return render_template(
        'index.html',
        default_caffeine=bundle.defaults['caffeine_intake'],
        default_screen_before_bed=bundle.defaults['screen_time_before_bed'],
    )


@app.post('/api/predict')
def predict():
    bundle = get_bundle()

    data = request.get_json(silent=True) or {}

    required = [
        'social_media_hours',
        'gaming_hours',
        'online_work_hours',
        'physical_activity_hours',
        'age',
    ]
    missing = [k for k in required if k not in data]
    if missing:
        return jsonify({'error': f"Missing fields: {', '.join(missing)}"}), 400

    social = _as_float(data.get('social_media_hours'), 'social_media_hours')
    gaming = _as_float(data.get('gaming_hours'), 'gaming_hours')
    work = _as_float(data.get('online_work_hours'), 'online_work_hours')
    activity = _as_float(data.get('physical_activity_hours'), 'physical_activity_hours')
    age = _as_float(data.get('age'), 'age')

    caffeine = data.get('caffeine_intake', bundle.defaults['caffeine_intake'])
    screen_before_bed = data.get('screen_time_before_bed', bundle.defaults['screen_time_before_bed'])

    caffeine = _as_float(caffeine, 'caffeine_intake')
    screen_before_bed = _as_float(screen_before_bed, 'screen_time_before_bed')

    total_screen_time = social + gaming + work
    activity_ratio = activity / (total_screen_time + 0.1)
    caffeine_effect = caffeine * screen_before_bed

    row = {
        'social_media_hours': social,
        'gaming_hours': gaming,
        'online_work_hours': work,
        'total_screen_time': total_screen_time,
        'physical_activity_hours': activity,
        'caffeine_intake': caffeine,
        'screen_time_before_bed': screen_before_bed,
        'age': age,
        'activity_ratio': activity_ratio,
        'caffeine_effect': caffeine_effect,
    }

    X_in = pd.DataFrame([row], columns=FEATURES)

    pred_hours = float(bundle.lr.predict(X_in)[0])

    X_scaled = bundle.scaler.transform(X_in)
    pred_cat_num = int(bundle.knn.predict(X_scaled)[0])

    sleep_category = _num_to_label(pred_cat_num)

    return jsonify(
        {
            'predicted_sleep_hours': pred_hours,
            'sleep_category': sleep_category,
            'recommendation': _recommendation_for(sleep_category),
        }
    )


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
