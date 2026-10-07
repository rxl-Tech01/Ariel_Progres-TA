from flask import Flask, jsonify, render_template

app = Flask(__name__)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/node/latest")
def latest_node():
    return jsonify({
        "nodeId": "NODE-001",
        "status": "Online",
        "provider": "by.U",
        "quota": 8.4,
        "signal": -75,
        "expiredDate": "24 Oktober 2026",
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", debug=False)
