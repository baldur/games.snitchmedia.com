var LEFT = 37
var RIGHT = 39
var UP = 38
var DOWN = 40

var listeners = {
    checkWall: function(evt) {
        if(0 <= evt.data[3].left && 
              evt.data[2].width > evt.data[3].left && 
              0 <= evt.data[3].top && 
              evt.data[2].height > evt.data[3].top) {
            message = ["wall", "ok"];
        } else {
            message = ["wall", "boom"];
        }
        postMessage(message);
    },
    checkSnake: function(evt) {
        var direction = evt.data[1];
        var currentPos = evt.data[2];
        var snake = evt.data[3];
        var distance = {};
        distance[RIGHT] = { y:  0, x:  5 };
        distance[LEFT]  = { y:  0, x: -5 };
        distance[UP]    = { y: -5, x:  0 };
        distance[DOWN]  = { y:  5, x:  0 };

        currentPos.left = currentPos.left + distance[direction];
        currentPos.top = currentPos + distance[direction];

        for(var i = 0; i<snake.y.length; i++) {
            if(currentPos.top === snake.y[i] && currentPos.left === snake.x[i]) {
                postMessage(['snake', 'hit the snake', currentPos, snake]);
            }
        }

    }
};

onmessage = function (evt) {
    var method = listeners[evt.data[0]];
    if(method){
        method(evt); 
    } else {
        postMessage('dont know how to process this');
    }
};
